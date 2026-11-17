/** Token bucket: `capacity` burst, refilled at `refillPerSecond`. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly now: () => number = Date.now,
  ) {
    this.tokens = capacity;
    this.last = now();
  }

  take(cost = 1): boolean {
    const t = this.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((t - this.last) / 1000) * this.refillPerSecond);
    this.last = t;
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }
}

/** Per-player limits for discrete actions. Inputs are limited separately by `InputBudget`. */
export function createActionLimits(now: () => number = Date.now) {
  return {
    roomChat: new TokenBucket(5, 0.5, now),
    zoneChat: new TokenBucket(3, 0.2, now),
    globalChat: new TokenBucket(2, 0.1, now),
    emote: new TokenBucket(3, 0.5, now),
    interact: new TokenBucket(4, 1, now),
    travel: new TokenBucket(2, 0.1, now),
    voice: new TokenBucket(3, 0.1, now),
    voiceState: new TokenBucket(20, 8, now),
    avatar: new TokenBucket(3, 0.05, now),
    ping: new TokenBucket(4, 1, now),
  };
}
export type ActionLimits = ReturnType<typeof createActionLimits>;

/**
 * Counts protocol violations (malformed or rate-limited messages). Each strike decays after
 * `windowMs`; reaching `max` strikes inside the window means the client should be removed.
 */
export class StrikeCounter {
  private strikes: number[] = [];

  constructor(
    private readonly max = 20,
    private readonly windowMs = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a strike; returns true when the limit has been reached. */
  add(): boolean {
    const t = this.now();
    this.strikes = this.strikes.filter((s) => t - s < this.windowMs);
    this.strikes.push(t);
    return this.strikes.length >= this.max;
  }

  get count(): number {
    return this.strikes.length;
  }
}
