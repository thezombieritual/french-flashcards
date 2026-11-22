import type { CardState, Settings } from './types';

/** Latest review wins for a card. The whole schedule from that review is kept. */
export function laterCard(a: CardState | null, b: CardState | null): CardState | null {
  if (!a) return b;
  if (!b) return a;
  const aTime = a.lastReview ?? a.updatedAt;
  const bTime = b.lastReview ?? b.updatedAt;
  if (aTime === bTime) return a.updatedAt >= b.updatedAt ? a : b;
  return aTime > bTime ? a : b;
}

export function laterSettings(a: Settings, b: Settings): Settings {
  return a.updatedAt >= b.updatedAt ? a : b;
}
