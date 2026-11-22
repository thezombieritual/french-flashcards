import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from './config';
import { laterCard, laterSettings } from './merge';
import { getStore, normalizeSettings, replaceFromSync, type Store } from './storage';
import type { CardState, Grade, ReviewLog, Settings } from './types';

let clientPromise: Promise<SupabaseClient> | null = null;

export function isSyncConfigured(): boolean {
  return supabaseConfig.url.startsWith('https://') && supabaseConfig.anonKey.length > 20;
}

export function redirectTo(): string {
  return `${location.origin}${import.meta.env.BASE_URL}`;
}

async function client(): Promise<SupabaseClient | null> {
  if (!isSyncConfigured()) return null;
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(supabaseConfig.url, supabaseConfig.anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
        },
      }),
    );
  }
  return clientPromise;
}

export async function currentEmail(): Promise<string | null> {
  const supabase = await client();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.email ?? null;
}

export async function signInWithPassword(email: string, password: string): Promise<string> {
  const supabase = await client();
  if (!supabase) return 'Sync is not set up yet.';
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return error.message;
  return '';
}

export async function signUp(email: string, password: string): Promise<string> {
  const supabase = await client();
  if (!supabase) return 'Sync is not set up yet.';
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return error.message;
  if (!data.session) return 'Check your email to confirm the account, then sign in.';
  return '';
}

export async function sendMagicLink(email: string): Promise<string> {
  const supabase = await client();
  if (!supabase) return 'Sync is not set up yet.';
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo() },
  });
  if (error) return error.message;
  return 'Check your email for the sign-in link. On iPhone, open that link in Safari, not from the home-screen icon.';
}

export async function signOut(): Promise<void> {
  const supabase = await client();
  if (!supabase) return;
  await supabase.auth.signOut();
}

interface RemoteState {
  card_id: string;
  ease: number;
  interval_days: number;
  repetitions: number;
  due: string;
  lapses: number;
  last_review: string | null;
  state: CardState['state'];
  learning_step: number;
  introduced_on: string | null;
  updated_at: string;
}

interface RemoteReview {
  card_id: string;
  grade: Grade;
  reviewed_at: string;
}

interface RemoteSettings {
  new_per_day: number;
  autoplay: boolean;
  disabled_deck_ids: string[] | null;
  updated_at: string;
}

function toRemoteState(userId: string, state: CardState): RemoteState & { user_id: string } {
  return {
    user_id: userId,
    card_id: state.cardId,
    ease: state.ease,
    interval_days: state.intervalDays,
    repetitions: state.repetitions,
    due: new Date(state.due).toISOString(),
    lapses: state.lapses,
    last_review: state.lastReview ? new Date(state.lastReview).toISOString() : null,
    state: state.state,
    learning_step: state.learningStep,
    introduced_on: state.introducedOn,
    updated_at: new Date(state.updatedAt || state.lastReview || Date.now()).toISOString(),
  };
}

function fromRemoteState(row: RemoteState): CardState {
  const updatedAt = Date.parse(row.updated_at);
  return {
    cardId: row.card_id,
    ease: row.ease,
    intervalDays: row.interval_days,
    repetitions: row.repetitions,
    due: Date.parse(row.due),
    lapses: row.lapses,
    lastReview: row.last_review ? Date.parse(row.last_review) : null,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0,
    state: row.state,
    learningStep: row.learning_step ?? 0,
    introducedOn: row.introduced_on,
  };
}

function fromRemoteSettings(row: RemoteSettings): Settings {
  return normalizeSettings({
    newPerDay: row.new_per_day,
    autoplay: row.autoplay,
    disabledDeckIds: row.disabled_deck_ids ?? [],
    updatedAt: Date.parse(row.updated_at),
  });
}

async function pullAll<T>(supabase: SupabaseClient, table: string): Promise<T[]> {
  const rows: T[] = [];
  const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + page - 1);
    if (error) throw error;
    const chunk = (data ?? []) as T[];
    rows.push(...chunk);
    if (chunk.length < page) break;
  }
  return rows;
}

export type SyncResult = 'off' | 'signed-out' | 'ok' | 'error';

export async function syncNow(): Promise<SyncResult> {
  const supabase = await client();
  if (!supabase) return 'off';
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session) return 'signed-out';
  const userId = sessionData.session.user.id;

  try {
    const store = getStore();
    const [remoteStates, remoteReviews, remoteSettingsRows] = await Promise.all([
      pullAll<RemoteState>(supabase, 'card_states'),
      pullAll<RemoteReview>(supabase, 'review_logs'),
      pullAll<RemoteSettings>(supabase, 'user_settings'),
    ]);

    const localStates = new Map(store.states);
    const toPush: CardState[] = [];
    const seen = new Set<string>();

    for (const row of remoteStates) {
      const remote = fromRemoteState(row);
      seen.add(remote.cardId);
      const local = localStates.get(remote.cardId) ?? null;
      const winner = laterCard(local, remote);
      if (!winner) continue;
      localStates.set(winner.cardId, winner);
      if (winner === local && local && (local.lastReview ?? local.updatedAt) > (remote.lastReview ?? remote.updatedAt)) {
        toPush.push(local);
      }
    }
    for (const [id, local] of store.states) {
      if (!seen.has(id)) toPush.push(local);
    }
    for (const id of store.dirty.cardIds) {
      const local = localStates.get(id);
      if (local && !toPush.some((item) => item.cardId === id)) toPush.push(local);
    }

    const reviews = new Map<string, ReviewLog>();
    for (const review of store.reviews) reviews.set(review.id, review);
    for (const row of remoteReviews) {
      const reviewedAt = Date.parse(row.reviewed_at);
      const id = `${row.card_id}|${reviewedAt}`;
      if (!reviews.has(id)) {
        reviews.set(id, { id, cardId: row.card_id, grade: row.grade, reviewedAt, synced: true });
      }
    }

    let settings = store.settings;
    const remoteSettings = remoteSettingsRows[0] ? fromRemoteSettings(remoteSettingsRows[0]) : null;
    if (remoteSettings) settings = laterSettings(settings, remoteSettings);
    const pushSettings = !remoteSettings || settings.updatedAt > remoteSettings.updatedAt;

    const unsyncedReviews = [...reviews.values()].filter((review) => review.synced !== true);

    if (toPush.length) {
      const { error } = await supabase.from('card_states').upsert(
        toPush.map((state) => toRemoteState(userId, state)),
        { onConflict: 'user_id,card_id' },
      );
      if (error) throw error;
    }
    if (unsyncedReviews.length) {
      const { error } = await supabase.from('review_logs').upsert(
        unsyncedReviews.map((review) => ({
          user_id: userId,
          card_id: review.cardId,
          grade: review.grade,
          reviewed_at: new Date(review.reviewedAt).toISOString(),
        })),
        { onConflict: 'user_id,card_id,reviewed_at' },
      );
      if (error) throw error;
    }
    if (pushSettings && settings.updatedAt > 0) {
      const { error } = await supabase.from('user_settings').upsert(
        {
          user_id: userId,
          new_per_day: settings.newPerDay,
          autoplay: settings.autoplay,
          disabled_deck_ids: settings.disabledDeckIds,
          updated_at: new Date(settings.updatedAt).toISOString(),
        },
        { onConflict: 'user_id' },
      );
      if (error) throw error;
    }

    const next: Store = {
      states: localStates,
      reviews: [...reviews.values()].map((review) => ({ ...review, synced: true })),
      settings,
      dirty: { cardIds: [], reviewIds: [], settings: false },
    };
    await replaceFromSync(next);
    return 'ok';
  } catch {
    return 'error';
  }
}
