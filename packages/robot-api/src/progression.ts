/**
 * Learning levels: level n starts at 50·n·(n-1) XP (0, 100, 300, 600, …), so each level takes
 * 100 XP more than the previous one.
 */
export const levelStartXp = (level: number): number => 50 * level * (level - 1);

export function levelForXp(xp: number): number {
  let level = 1;
  while (levelStartXp(level + 1) <= xp) level++;
  return level;
}

export function levelProgress(xp: number): { level: number; levelXp: number; levelSpan: number } {
  const level = levelForXp(xp);
  const start = levelStartXp(level);
  return { level, levelXp: xp - start, levelSpan: levelStartXp(level + 1) - start };
}

/**
 * Next streak value after activity on `today` (UTC dates, `YYYY-MM-DD`). Activity on the day after
 * the last one extends the streak; a gap restarts it at 1.
 */
export function nextStreak(current: number, lastActivity: string | null, today: string): number {
  if (lastActivity === today) return Math.max(current, 1);
  if (lastActivity && dayAfter(lastActivity) === today) return current + 1;
  return 1;
}

export function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
