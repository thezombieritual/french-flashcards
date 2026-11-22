export function dayKey(ts: number): string {
  const date = new Date(ts);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function startOfDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Local midnight, `days` ahead of the day containing `ts`. */
export function addDays(ts: number, days: number): number {
  const date = new Date(startOfDay(ts));
  date.setDate(date.getDate() + days);
  return date.getTime();
}

export function previousDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  date.setDate(date.getDate() - 1);
  return dayKey(date.getTime());
}

/**
 * Consecutive study days ending today, or ending yesterday if today
 * has no review yet. A missed day before yesterday breaks the streak.
 */
export function streakFromDays(days: Iterable<string>, today: string): number {
  const set = new Set(days);
  let cursor = today;
  if (!set.has(cursor)) {
    cursor = previousDay(today);
    if (!set.has(cursor)) return 0;
  }
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = previousDay(cursor);
  }
  return streak;
}
