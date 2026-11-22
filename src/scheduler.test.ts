import { describe, expect, it } from 'vitest';
import { dayKey, previousDay, streakFromDays } from './dates';
import { laterCard, laterSettings } from './merge';
import { buildSessionIds } from './queue';
import { freshState, intervalLabel, schedule } from './scheduler';
import { defaultSettings } from './storage';
import { formatFrench } from './text';

const now = new Date(2026, 10, 22, 15, 0, 0).getTime();
const today = '2026-11-22';

describe('schedule', () => {
  it('does not mutate the previous state', () => {
    const state = freshState('bonjour');
    const copy = { ...state };
    schedule(state, 'good', now, today);
    expect(state).toEqual(copy);
  });

  it('graduates a new card on Good to one day', () => {
    const next = schedule(freshState('bonjour'), 'good', now, today);
    expect(next.state).toBe('review');
    expect(next.intervalDays).toBe(1);
    expect(next.repetitions).toBe(1);
    expect(next.introducedOn).toBe(today);
    expect(intervalLabel(now, next)).toBe('1 day');
  });

  it('uses the classic second and third good intervals', () => {
    const first = schedule(freshState('pain'), 'good', now, today);
    const second = schedule(first, 'good', now, today);
    const third = schedule(second, 'good', now, today);
    expect(second.intervalDays).toBe(6);
    expect(third.intervalDays).toBe(15);
    expect(intervalLabel(now, second)).toBe('6 days');
  });

  it('shows Again as immediate and Hard on a new card as 10 minutes', () => {
    const again = schedule(freshState('eau'), 'again', now, today);
    const hard = schedule(freshState('eau'), 'hard', now, today);
    expect(again.state).toBe('learning');
    expect(again.due).toBe(now);
    expect(again.lapses).toBe(1);
    expect(intervalLabel(now, again)).toBe('<1m');
    expect(hard.state).toBe('learning');
    expect(intervalLabel(now, hard)).toBe('10m');
    expect(hard.lapses).toBe(0);
  });

  it('gives Easy four days and skips the six-day step', () => {
    const easy = schedule(freshState('maison'), 'easy', now, today);
    expect(easy.intervalDays).toBe(4);
    expect(easy.repetitions).toBeGreaterThanOrEqual(2);
    const follow = schedule(easy, 'good', now, today);
    expect(follow.intervalDays).toBeGreaterThanOrEqual(4);
  });

  it('shrinks ease on Again and never drops below 1.3', () => {
    let state = freshState('sel');
    state = schedule(state, 'good', now, today);
    state = schedule(state, 'good', now, today);
    const lapsed = schedule(state, 'again', now, today);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.repetitions).toBe(0);
    expect(lapsed.ease).toBe(2.3);
    let tired = lapsed;
    for (let i = 0; i < 20; i += 1) tired = schedule(tired, 'again', now, today);
    expect(tired.ease).toBe(1.3);
  });

  it('grows a review card slowly on Hard', () => {
    let state = schedule(freshState('vin'), 'good', now, today);
    state = schedule(state, 'good', now, today);
    state.intervalDays = 10;
    const hard = schedule(state, 'hard', now, today);
    expect(hard.intervalDays).toBe(12);
    expect(intervalLabel(now, hard)).toBe('12 days');
  });
});

describe('days and streak', () => {
  it('keeps a streak that is still alive yesterday', () => {
    expect(streakFromDays(['2026-11-22'], '2026-11-22')).toBe(1);
    expect(streakFromDays(['2026-11-21', '2026-11-20'], '2026-11-22')).toBe(2);
    expect(streakFromDays(['2026-11-20'], '2026-11-22')).toBe(0);
    expect(streakFromDays([], '2026-11-22')).toBe(0);
  });

  it('crosses month boundaries', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(streakFromDays(['2026-03-01', '2026-02-28', '2026-02-27'], '2026-03-01')).toBe(3);
    expect(dayKey(new Date(2026, 0, 2).getTime())).toBe('2026-01-02');
  });
});

describe('queue', () => {
  it('limits new cards and puts due reviews first', () => {
    const deck = [
      { id: 'a', deckId: 'family' },
      { id: 'b', deckId: 'family' },
      { id: 'c', deckId: 'family' },
      { id: 'd', deckId: 'other' },
    ];
    const due = freshState('b');
    due.state = 'review';
    due.due = now - 1000;
    due.intervalDays = 3;
    const future = freshState('c');
    future.state = 'review';
    future.due = now + 86_400_000;
    future.intervalDays = 2;
    const states = new Map([
      ['b', due],
      ['c', future],
    ]);
    const settings = defaultSettings();
    settings.newPerDay = 1;
    settings.disabledDeckIds = ['other'];
    expect(buildSessionIds(deck, states, settings, now, today)).toEqual(['b', 'a']);
  });

  it('counts cards introduced today against the new-card limit', () => {
    const seen = freshState('a');
    seen.introducedOn = today;
    seen.state = 'review';
    seen.due = now + 86_400_000;
    const settings = defaultSettings();
    settings.newPerDay = 2;
    const ids = buildSessionIds(
      [
        { id: 'a', deckId: 'family' },
        { id: 'b', deckId: 'family' },
        { id: 'c', deckId: 'family' },
      ],
      new Map([['a', seen]]),
      settings,
      now,
      today,
    );
    expect(ids).toEqual(['b']);
  });
});

describe('merge and french', () => {
  it('keeps the later review for a card', () => {
    const early = freshState('pain');
    early.lastReview = 10;
    early.updatedAt = 10;
    early.lapses = 1;
    const late = freshState('pain');
    late.lastReview = 20;
    late.updatedAt = 20;
    late.lapses = 4;
    expect(laterCard(early, late)?.lapses).toBe(4);
    expect(laterCard(late, early)?.lapses).toBe(4);
    expect(laterCard(early, null)).toBe(early);
    const settings = defaultSettings();
    expect(laterSettings({ ...settings, updatedAt: 5 }, { ...settings, updatedAt: 2, newPerDay: 3 }).newPerDay).toBe(10);
  });

  it('joins articles the way they are said', () => {
    expect(formatFrench({ article: 'le', french: 'pain' })).toBe('le pain');
    expect(formatFrench({ article: "l'", french: 'eau' })).toBe("l'eau");
    expect(formatFrench({ article: null, french: 'Bonjour' })).toBe('Bonjour');
  });
});
