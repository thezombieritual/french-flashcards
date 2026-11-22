import type { CardState, Settings } from './types';

export interface QueueCard {
  id: string;
  deckId: string;
}

export function buildSessionIds(
  cards: QueueCard[],
  states: Map<string, CardState>,
  settings: Settings,
  now: number,
  today: string,
): string[] {
  const enabled = cards.filter((card) => !settings.disabledDeckIds.includes(card.deckId));
  const learning: { id: string; due: number }[] = [];
  const reviews: { id: string; due: number }[] = [];

  for (const card of enabled) {
    const state = states.get(card.id);
    if (!state || state.state === 'new' || state.due > now) continue;
    const bucket = state.state === 'learning' ? learning : reviews;
    bucket.push({ id: card.id, due: state.due });
  }
  learning.sort((a, b) => a.due - b.due);
  reviews.sort((a, b) => a.due - b.due);

  const introducedToday = [...states.values()].filter((state) => state.introducedOn === today).length;
  let slots = Math.max(0, settings.newPerDay - introducedToday);
  const fresh: string[] = [];
  for (const card of enabled) {
    if (slots <= 0) break;
    const state = states.get(card.id);
    if (!state || state.state === 'new') {
      fresh.push(card.id);
      slots -= 1;
    }
  }

  return [...learning.map((item) => item.id), ...reviews.map((item) => item.id), ...fresh];
}
