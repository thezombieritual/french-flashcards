import type { CardState, DirtySet, ReviewLog, Settings } from './types';

const DB_NAME = 'french-flashcards';
const DB_VERSION = 1;
const FALLBACK_KEY = 'ff.snapshot';

export const defaultSettings = (): Settings => ({
  newPerDay: 10,
  autoplay: false,
  disabledDeckIds: [],
  updatedAt: 0,
});

interface Snapshot {
  states: CardState[];
  reviews: ReviewLog[];
  settings: Settings;
  dirty: DirtySet;
}

const emptyDirty = (): DirtySet => ({ cardIds: [], reviewIds: [], settings: false });

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('states')) db.createObjectStore('states', { keyPath: 'cardId' });
      if (!db.objectStoreNames.contains('reviews')) db.createObjectStore('reviews', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readFallback(): Snapshot | null {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Snapshot;
    if (!parsed || !Array.isArray(parsed.states) || !parsed.settings) return null;
    return parsed;
  } catch {
    return null;
  }
}

function stamp(snapshot: Snapshot): number {
  let latest = snapshot.settings.updatedAt;
  for (const state of snapshot.states) latest = Math.max(latest, state.updatedAt);
  for (const review of snapshot.reviews) latest = Math.max(latest, review.reviewedAt);
  return latest;
}

function writeFallback(snapshot: Snapshot): void {
  try {
    const existing = readFallback();
    if (existing && stamp(existing) > stamp(snapshot)) return;
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(snapshot));
  } catch {
    /* Private mode can refuse the write. IndexedDB may still have the data. */
  }
}

async function readSnapshot(db: IDBDatabase | null): Promise<Snapshot> {
  if (!db) return readFallback() ?? { states: [], reviews: [], settings: defaultSettings(), dirty: emptyDirty() };
  const tx = db.transaction(['states', 'reviews', 'meta'], 'readonly');
  const states = await requestToPromise(tx.objectStore('states').getAll() as IDBRequest<CardState[]>);
  const reviews = await requestToPromise(tx.objectStore('reviews').getAll() as IDBRequest<ReviewLog[]>);
  const settingsRow = await requestToPromise(
    tx.objectStore('meta').get('settings') as IDBRequest<{ key: string; value: Settings } | undefined>,
  );
  const dirtyRow = await requestToPromise(
    tx.objectStore('meta').get('dirty') as IDBRequest<{ key: string; value: DirtySet } | undefined>,
  );
  return {
    states,
    reviews,
    settings: normalizeSettings(settingsRow?.value ?? defaultSettings()),
    dirty: dirtyRow?.value ?? emptyDirty(),
  };
}

export function normalizeSettings(input: Partial<Settings> | null | undefined): Settings {
  const base = defaultSettings();
  const newPerDay = Number(input?.newPerDay);
  return {
    newPerDay: Number.isFinite(newPerDay) ? Math.min(40, Math.max(0, Math.round(newPerDay))) : base.newPerDay,
    autoplay: Boolean(input?.autoplay),
    disabledDeckIds: Array.isArray(input?.disabledDeckIds)
      ? input.disabledDeckIds.filter((id): id is string => typeof id === 'string')
      : [],
    updatedAt: typeof input?.updatedAt === 'number' ? input.updatedAt : 0,
  };
}

export interface Store {
  states: Map<string, CardState>;
  reviews: ReviewLog[];
  settings: Settings;
  dirty: DirtySet;
}

let cache: Store | null = null;

function latestStamp(snapshot: Snapshot): number {
  return stamp(snapshot);
}

export async function loadStore(): Promise<Store> {
  const db = await openDb();
  const primary = await readSnapshot(db);
  const fallback = readFallback();
  const snapshot = fallback && latestStamp(fallback) > latestStamp(primary) ? fallback : primary;
  cache = {
    states: new Map(snapshot.states.map((state) => [state.cardId, state])),
    reviews: snapshot.reviews,
    settings: snapshot.settings,
    dirty: {
      cardIds: [...snapshot.dirty.cardIds],
      reviewIds: [...snapshot.dirty.reviewIds],
      settings: Boolean(snapshot.dirty.settings),
    },
  };
  if (snapshot !== primary) await persist();
  return cache;
}

export function getStore(): Store {
  if (!cache) throw new Error('Store is not loaded');
  return cache;
}

let idbBroken = false;
let persistChain: Promise<void> = Promise.resolve();

function mirror(): void {
  if (!cache) return;
  writeFallback({
    states: [...cache.states.values()],
    reviews: cache.reviews,
    settings: cache.settings,
    dirty: {
      cardIds: [...cache.dirty.cardIds],
      reviewIds: [...cache.dirty.reviewIds],
      settings: cache.dirty.settings,
    },
  });
}

function persist(): Promise<void> {
  persistChain = persistChain.then(writeSnapshot, writeSnapshot);
  return persistChain;
}

async function writeSnapshot(): Promise<void> {
  if (!cache) return;
  const snapshot: Snapshot = {
    states: [...cache.states.values()],
    reviews: cache.reviews,
    settings: cache.settings,
    dirty: {
      cardIds: [...cache.dirty.cardIds],
      reviewIds: [...cache.dirty.reviewIds],
      settings: cache.dirty.settings,
    },
  };
  const db = idbBroken ? null : await openDb();
  if (db) {
    try {
      await writeDb(db, snapshot);
    } catch {
      idbBroken = true;
    }
  }
  writeFallback(snapshot);
}

async function writeDb(db: IDBDatabase, snapshot: Snapshot): Promise<void> {
  const tx = db.transaction(['states', 'reviews', 'meta'], 'readwrite');
  const states = tx.objectStore('states');
  const reviews = tx.objectStore('reviews');
  const meta = tx.objectStore('meta');
  states.clear();
  reviews.clear();
  for (const state of snapshot.states) states.put(state);
  for (const review of snapshot.reviews) reviews.put(review);
  meta.put({ key: 'settings', value: snapshot.settings });
  meta.put({ key: 'dirty', value: snapshot.dirty });
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function remember(list: string[], id: string): void {
  if (!list.includes(id)) list.push(id);
}

export async function saveReview(state: CardState, review: ReviewLog): Promise<void> {
  const store = getStore();
  store.states.set(state.cardId, state);
  const existing = store.reviews.findIndex((item) => item.id === review.id);
  if (existing >= 0) store.reviews[existing] = review;
  else store.reviews.push(review);
  remember(store.dirty.cardIds, state.cardId);
  remember(store.dirty.reviewIds, review.id);
  mirror();
  await persist();
}

export async function saveSettings(settings: Settings): Promise<void> {
  const store = getStore();
  store.settings = normalizeSettings(settings);
  store.dirty.settings = true;
  mirror();
  await persist();
}

export async function replaceFromSync(next: Store): Promise<void> {
  cache = next;
  await persist();
}

export function reviewId(cardId: string, reviewedAt: number): string {
  return `${cardId}|${reviewedAt}`;
}
