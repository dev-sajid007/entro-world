/**
 * Daily AI usage counters live in Redis under these keys (shared by the AI agent service, which
 * writes them, and the API, which reports them). Days are UTC.
 */
export const utcDay = (at: Date = new Date()): string => at.toISOString().slice(0, 10);

export const aiUsageKey = (kind: "requests" | "tokens", userId: string, day: string = utcDay()): string => `ew:ai:${kind}:${userId}:${day}`;

/** Counters outlive their day a little so late reads still work. */
export const AI_USAGE_TTL_SECONDS = 2 * 24 * 3600;

/** Start of the next UTC day. */
export const nextUtcMidnight = (at: Date = new Date()): Date => {
  const d = new Date(at);
  d.setUTCHours(24, 0, 0, 0);
  return d;
};
