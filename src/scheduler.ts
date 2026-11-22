import { addDays } from './dates';
import type { CardState, Grade } from './types';

const MIN_EASE = 1.3;
const MAX_EASE = 3.2;
const MAX_INTERVAL = 3650;

/**
 * SM-2 style scheduler with four Anki-like grades.
 *
 * Good follows the classic steps: 1 day, then 6 days, then interval × ease.
 * Easy leaves the learning steps early. Hard grows a review interval slowly.
 * Again resets the ladder, counts a lapse, and is due immediately so the
 * session can show the card again.
 */
export function freshState(cardId: string): CardState {
  return {
    cardId,
    ease: 2.5,
    intervalDays: 0,
    repetitions: 0,
    due: 0,
    lapses: 0,
    lastReview: null,
    updatedAt: 0,
    state: 'new',
    learningStep: 0,
    introducedOn: null,
  };
}

function clampEase(ease: number): number {
  return Math.round(Math.min(MAX_EASE, Math.max(MIN_EASE, ease)) * 100) / 100;
}

export function schedule(prev: CardState, grade: Grade, now: number, today: string): CardState {
  const next: CardState = { ...prev, lastReview: now, updatedAt: now };
  if (!next.introducedOn) next.introducedOn = today;

  if (grade === 'again') {
    next.lapses += 1;
    next.repetitions = 0;
    next.intervalDays = 0;
    next.learningStep = 0;
    next.state = 'learning';
    next.ease = clampEase(prev.ease - 0.2);
    next.due = now;
    return next;
  }

  if (grade === 'hard') {
    next.ease = clampEase(prev.ease - 0.15);
    if (prev.state === 'new' || prev.state === 'learning') {
      next.state = 'learning';
      next.learningStep = 1;
      next.intervalDays = 0;
      next.due = now + 10 * 60_000;
      return next;
    }
    next.state = 'review';
    next.intervalDays = Math.min(MAX_INTERVAL, Math.max(1, Math.round(prev.intervalDays * 1.2)));
    next.repetitions = prev.repetitions + 1;
    next.due = addDays(now, next.intervalDays);
    return next;
  }

  if (grade === 'good') {
    next.state = 'review';
    next.learningStep = 0;
    if (prev.repetitions <= 0) next.intervalDays = 1;
    else if (prev.repetitions === 1) next.intervalDays = 6;
    else {
      next.intervalDays = Math.min(
        MAX_INTERVAL,
        Math.max(1, Math.round(prev.intervalDays * prev.ease)),
      );
    }
    next.repetitions = prev.repetitions + 1;
    next.due = addDays(now, next.intervalDays);
    return next;
  }

  next.ease = clampEase(prev.ease + 0.15);
  next.state = 'review';
  next.learningStep = 0;
  if (prev.state === 'new' || prev.state === 'learning') {
    next.intervalDays = 4;
    next.repetitions = Math.max(prev.repetitions + 1, 2);
  } else {
    next.intervalDays = Math.min(
      MAX_INTERVAL,
      Math.max(1, Math.round(prev.intervalDays * next.ease * 1.3)),
    );
    next.repetitions = prev.repetitions + 1;
  }
  next.due = addDays(now, next.intervalDays);
  return next;
}

export function intervalLabel(now: number, next: CardState): string {
  if (next.intervalDays >= 365) {
    const years = Math.round((next.intervalDays / 365) * 10) / 10;
    return `${years} yr`;
  }
  if (next.intervalDays >= 30) {
    const months = Math.round(next.intervalDays / 30);
    return months === 1 ? '1 mo' : `${months} mo`;
  }
  if (next.intervalDays > 1) return `${next.intervalDays} days`;
  if (next.intervalDays === 1) return '1 day';
  const ms = Math.max(0, next.due - now);
  if (ms <= 90_000) return '<1m';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}
