import { dayKey } from './dates';
import { allCards, loadCatalog } from './decks';
import { buildSessionIds } from './queue';
import { renderHome, renderSettings, renderStudy, renderTricky, type StudyModel, type View } from './render';
import { freshState, intervalLabel, schedule } from './scheduler';
import { canSpeak, prepareVoices, speakFrench, stopSpeech } from './speech';
import { summarize } from './stats';
import { getStore, loadStore, normalizeSettings, reviewId, saveReview, saveSettings } from './storage';
import {
  currentEmail,
  isSyncConfigured,
  sendMagicLink,
  signInWithPassword,
  signOut,
  signUp,
  syncNow,
} from './sync';
import { formatFrench } from './text';
import type { Card, Grade } from './types';

interface Session {
  queue: string[];
  currentId: string | null;
  counts: Record<Grade, number>;
  flipped: boolean;
}

const catalog = loadCatalog();
const cards = allCards(catalog.decks);
const cardById = new Map(cards.map((card) => [card.id, card]));

let session: Session | null = null;
let userEmail: string | null = null;
let authMessage = '';
let authBusy = false;
let syncLabel = 'On this phone';
let grading = false;
let learningTimer = 0;

function parseHash(): View {
  const raw = location.hash.replace(/^#\/?/, '');
  if (raw === 'study' || raw === 'tricky' || raw === 'settings') return raw;
  return 'home';
}

function readAuthError(): string {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  if (!raw.includes('error')) return '';
  const params = new URLSearchParams(raw);
  return params.get('error_description')?.replaceAll('+', ' ') ?? '';
}

function stripAuthHash(): void {
  const raw = location.hash.startsWith('#') ? location.hash.slice(1) : '';
  if (raw.includes('access_token') || raw.includes('error')) {
    history.replaceState(null, '', location.pathname + location.search);
  }
}

function upcoming(): { count: number; minutes: number } | null {
  const now = Date.now();
  const disabled = new Set(getStore().settings.disabledDeckIds);
  let count = 0;
  let soonest = Infinity;
  for (const state of getStore().states.values()) {
    const card = cardById.get(state.cardId);
    if (!card || disabled.has(card.deckId)) continue;
    if (state.state !== 'learning' || state.due <= now) continue;
    const wait = state.due - now;
    if (wait > 20 * 60_000) continue;
    count += 1;
    soonest = Math.min(soonest, state.due);
  }
  if (!count) return null;
  return { count, minutes: Math.max(1, Math.round((soonest - now) / 60_000)) };
}

function startSession(): void {
  const store = getStore();
  const now = Date.now();
  const ids = buildSessionIds(cards, store.states, store.settings, now, dayKey(now));
  session = {
    queue: ids,
    currentId: null,
    counts: { again: 0, hard: 0, good: 0, easy: 0 },
    flipped: false,
  };
  session.currentId = session.queue.shift() ?? null;
}

function studyModel(): StudyModel {
  const current = session?.currentId ? cardById.get(session.currentId) ?? null : null;
  const now = Date.now();
  const today = dayKey(now);
  const state = current ? getStore().states.get(current.id) ?? freshState(current.id) : freshState('x');
  const previews = {
    again: intervalLabel(now, schedule(state, 'again', now, today)),
    hard: intervalLabel(now, schedule(state, 'hard', now, today)),
    good: intervalLabel(now, schedule(state, 'good', now, today)),
    easy: intervalLabel(now, schedule(state, 'easy', now, today)),
  };
  return {
    card: current,
    left: (session?.queue.length ?? 0) + (current ? 1 : 0),
    flipped: session?.flipped ?? false,
    previews,
    counts: session?.counts ?? { again: 0, hard: 0, good: 0, easy: 0 },
    upcoming: upcoming(),
    lapses: current ? state.lapses : 0,
  };
}

function paint(): void {
  const root = document.getElementById('app');
  if (!root) return;
  const view = parseHash();
  const store = getStore();
  const now = new Date();
  const summary = summarize(cards, store.states, store.reviews, store.settings, now.getTime(), dayKey(now.getTime()));
  if (view === 'home') {
    root.innerHTML = renderHome(summary, catalog.decks, catalog.planned, store.settings, syncLabel, now);
  } else if (view === 'study') {
    root.innerHTML = renderStudy(studyModel());
  } else if (view === 'tricky') {
    root.innerHTML = renderTricky(trickyRows());
  } else {
    root.innerHTML = renderSettings({
      settings: store.settings,
      configured: isSyncConfigured(),
      email: userEmail,
      message: authMessage,
      busy: authBusy,
    });
  }
}

function trickyRows() {
  return [...getStore().states.values()]
    .filter((state) => state.lapses > 0 && cardById.has(state.cardId))
    .sort((a, b) => b.lapses - a.lapses || a.ease - b.ease)
    .map((state) => ({ card: cardById.get(state.cardId) as Card, lapses: state.lapses }));
}

function onRoute(): void {
  const view = parseHash();
  if (view !== 'study') {
    session = null;
    stopSpeech();
    window.clearTimeout(learningTimer);
  } else if (!session) {
    startSession();
  }
  paint();
  armTimer();
}

function armTimer(): void {
  window.clearTimeout(learningTimer);
  if (parseHash() !== 'study' || session?.currentId) return;
  const next = upcoming();
  if (!next) return;
  learningTimer = window.setTimeout(() => {
    pullDueIntoSession();
  }, Math.max(500, next.minutes * 60_000));
}

function pullDueIntoSession(): void {
  if (!session || parseHash() !== 'study') return;
  const store = getStore();
  const now = Date.now();
  const ids = buildSessionIds(cards, store.states, store.settings, now, dayKey(now));
  const extra = ids.filter((id) => id !== session?.currentId && !session?.queue.includes(id));
  if (!extra.length) {
    armTimer();
    return;
  }
  session.queue.push(...extra);
  if (!session.currentId) {
    session.currentId = session.queue.shift() ?? null;
    session.flipped = false;
  }
  paint();
  armTimer();
}

function field(id: string): string {
  const element = document.getElementById(id);
  return element instanceof HTMLInputElement ? element.value.trim() : '';
}

async function runSync(quiet = false): Promise<void> {
  const result = await syncNow();
  if (result === 'ok') syncLabel = 'Synced';
  else if (result === 'error') syncLabel = 'Saved on this phone. Will sync when you are online.';
  else if (result === 'signed-out') syncLabel = 'Sign in to sync this phone.';
  else syncLabel = 'On this phone';
  if (!quiet || parseHash() !== 'study') paint();
}

function scheduleSync(): void {
  if (!isSyncConfigured() || !userEmail) return;
  window.setTimeout(() => {
    void runSync(true);
  }, 400);
}

async function grade(grade: Grade): Promise<void> {
  if (!session?.currentId || !session.flipped || grading) return;
  grading = true;
  const cardId = session.currentId;
  try {
    const now = Date.now();
    const today = dayKey(now);
    const prev = getStore().states.get(cardId) ?? freshState(cardId);
    const next = schedule(prev, grade, now, today);
    session.counts[grade] += 1;
    if (grade === 'again' && !session.queue.includes(cardId)) {
      session.queue.splice(session.queue.length === 0 ? 0 : 1, 0, cardId);
    }
    session.currentId = session.queue.shift() ?? null;
    session.flipped = false;
    stopSpeech();
    const saving = saveReview(next, {
      id: reviewId(cardId, now),
      cardId,
      grade,
      reviewedAt: now,
      synced: false,
    });
    paint();
    armTimer();
    await saving;
    scheduleSync();
  } finally {
    grading = false;
  }
}

function flip(): void {
  if (!session?.currentId) return;
  session.flipped = !session.flipped;
  const root = document.getElementById('app');
  root?.querySelector('.flip')?.classList.toggle('is-flipped', session.flipped);
  root?.querySelector('.grades')?.toggleAttribute('hidden', !session.flipped);
  root?.querySelector('[data-which="example"]')?.toggleAttribute('hidden', !session.flipped);
  root?.querySelector('.face.front')?.setAttribute('aria-hidden', session.flipped ? 'true' : 'false');
  root?.querySelector('.face.back')?.setAttribute('aria-hidden', session.flipped ? 'false' : 'true');
  root?.querySelector('.face.front')?.setAttribute('tabindex', session.flipped ? '-1' : '0');
  root?.querySelector('.face.back')?.setAttribute('tabindex', session.flipped ? '0' : '-1');
  if (session.flipped && getStore().settings.autoplay) {
    const card = cardById.get(session.currentId);
    if (card) speakFrench(formatFrench(card));
  }
}

function speakCurrent(which: string): void {
  if (!session?.currentId) return;
  const card = cardById.get(session.currentId);
  if (!card) return;
  if (!canSpeak()) {
    authMessage = 'This browser has no speech voices.';
    return;
  }
  speakFrench(which === 'example' ? card.example : formatFrench(card));
}

async function updateSettings(patch: Partial<{ newPerDay: number; autoplay: boolean; disabledDeckIds: string[] }>): Promise<void> {
  const next = normalizeSettings({
    ...getStore().settings,
    ...patch,
    updatedAt: Date.now(),
  });
  getStore().settings = next;
  paint();
  await saveSettings(next);
  scheduleSync();
}

function exportTricky(): void {
  const payload = {
    exportedAt: new Date().toISOString(),
    cards: trickyRows().map((row) => ({
      id: row.card.id,
      french: formatFrench(row.card),
      english: row.card.english,
      topic: row.card.topic,
      deckId: row.card.deckId,
      lapses: row.lapses,
      ease: getStore().states.get(row.card.id)?.ease ?? null,
      intervalDays: getStore().states.get(row.card.id)?.intervalDays ?? null,
    })),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'tricky-cards.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function onSignIn(): Promise<void> {
  const email = field('email');
  const password = field('password');
  authBusy = true;
  authMessage = '';
  paint();
  authMessage = await signInWithPassword(email, password);
  userEmail = await currentEmail();
  authBusy = false;
  if (!authMessage && userEmail) {
    authMessage = 'Signed in.';
    await runSync();
  } else {
    paint();
  }
}

async function onSignUp(): Promise<void> {
  const email = field('email');
  const password = field('password');
  if (password.length < 8) {
    authMessage = 'Use a password of at least 8 characters.';
    paint();
    return;
  }
  authBusy = true;
  paint();
  authMessage = await signUp(email, password);
  userEmail = await currentEmail();
  authBusy = false;
  if (!authMessage && userEmail) {
    authMessage = 'Account ready.';
    await runSync();
  } else {
    paint();
  }
}

async function onMagicLink(): Promise<void> {
  const email = field('email');
  if (!email) {
    authMessage = 'Enter your email first.';
    paint();
    return;
  }
  authBusy = true;
  paint();
  authMessage = await sendMagicLink(email);
  authBusy = false;
  paint();
}

function onClick(event: Event): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const actionEl = target.closest<HTMLElement>('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  if (action === 'flip') {
    flip();
    return;
  }
  if (action === 'speak') {
    event.stopPropagation();
    speakCurrent(actionEl.dataset.which ?? 'word');
    return;
  }
  if (action === 'grade') {
    const gradeName = actionEl.dataset.grade;
    if (gradeName === 'again' || gradeName === 'hard' || gradeName === 'good' || gradeName === 'easy') {
      void grade(gradeName);
    }
    return;
  }
  if (action === 'close') {
    location.hash = '#/';
    return;
  }
  if (action === 'refresh-session') {
    pullDueIntoSession();
    return;
  }
  if (action === 'new-dec' || action === 'new-inc') {
    const current = getStore().settings.newPerDay;
    void updateSettings({ newPerDay: action === 'new-dec' ? current - 1 : current + 1 });
    return;
  }
  if (action === 'toggle-autoplay') {
    void updateSettings({ autoplay: !getStore().settings.autoplay });
    return;
  }
  if (action === 'toggle-deck') {
    const id = actionEl.dataset.deck;
    if (!id) return;
    const disabled = new Set(getStore().settings.disabledDeckIds);
    if (disabled.has(id)) disabled.delete(id);
    else disabled.add(id);
    void updateSettings({ disabledDeckIds: [...disabled] });
    return;
  }
  if (action === 'export-tricky') {
    exportTricky();
    return;
  }
  if (action === 'sign-in') void onSignIn();
  if (action === 'sign-up') void onSignUp();
  if (action === 'magic-link') void onMagicLink();
  if (action === 'sign-out') {
    void signOut().then(async () => {
      userEmail = null;
      authMessage = 'Signed out on this phone.';
      syncLabel = 'Sign in to sync this phone.';
      paint();
    });
  }
  if (action === 'sync') void runSync();
}

function onKey(event: KeyboardEvent): void {
  if (parseHash() !== 'study') return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.target instanceof HTMLButtonElement) return;
  if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault();
    flip();
    return;
  }
  if (!session?.flipped) return;
  const grades: Record<string, Grade> = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
  const gradeName = grades[event.key];
  if (gradeName) {
    event.preventDefault();
    void grade(gradeName);
  }
}

export async function startApp(): Promise<void> {
  await loadStore();
  prepareVoices();
  authMessage = readAuthError();
  if (isSyncConfigured()) {
    userEmail = await currentEmail();
    syncLabel = userEmail ? 'Signed in' : 'Sign in to sync this phone.';
  }
  stripAuthHash();
  const root = document.getElementById('app');
  root?.addEventListener('click', onClick);
  root?.addEventListener(
    'error',
    (event) => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement) || !img.dataset.fallback) return;
      const fallback = document.createElement('span');
      fallback.className = 'pic-fallback';
      fallback.textContent = img.dataset.fallback;
      img.replaceWith(fallback);
    },
    true,
  );
  root?.addEventListener('submit', (event) => {
    event.preventDefault();
    void onSignIn();
  });
  document.addEventListener('keydown', onKey);
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('online', () => {
    void runSync(true);
  });
  onRoute();
  if (userEmail) void runSync(true);
}
