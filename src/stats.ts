import { dayKey, streakFromDays } from './dates';
import type { Card, CardState, ReviewLog, Settings } from './types';

export interface Summary {
  due: number;
  newLeft: number;
  streak: number;
  learned: number;
  accuracy: number | null;
  reviewsToday: number;
  tricky: number;
}

export function summarize(
  cards: Card[],
  states: Map<string, CardState>,
  reviews: ReviewLog[],
  settings: Settings,
  now: number,
  today: string,
): Summary {
  const enabled = new Set(
    cards.filter((card) => !settings.disabledDeckIds.includes(card.deckId)).map((card) => card.id),
  );
  let due = 0;
  let learned = 0;
  let tricky = 0;
  for (const state of states.values()) {
    if (!enabled.has(state.cardId)) continue;
    if (state.state !== 'new' && state.due <= now) due += 1;
    if (state.state === 'review' && state.intervalDays >= 1) learned += 1;
    if (state.lapses > 0) tricky += 1;
  }
  const introducedToday = [...states.values()].filter((state) => state.introducedOn === today).length;
  const remembered = reviews.filter((review) => review.grade === 'good' || review.grade === 'easy').length;
  return {
    due,
    newLeft: Math.max(0, settings.newPerDay - introducedToday),
    streak: streakFromDays(
      reviews.map((review) => dayKey(review.reviewedAt)),
      today,
    ),
    learned,
    accuracy: reviews.length ? remembered / reviews.length : null,
    reviewsToday: reviews.filter((review) => dayKey(review.reviewedAt) === today).length,
    tricky,
  };
}
