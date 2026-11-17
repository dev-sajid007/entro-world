import type { Redis } from "ioredis";
import { sql } from "drizzle-orm";
import { AI_USAGE_TTL_SECONDS, aiUsageKey, nextUtcMidnight, utcDay, type AiUsageView } from "@entroworld/agent-protocol";
import { agentUsage, type Database } from "@entroworld/database";

export interface QuotaLimits {
  requests: number;
  tokens: number;
}

export type Reservation = { ok: true; day: string; used: number } | { ok: false; day: string };

/**
 * Per-user daily request and token limits (SPEC-ADDENDUM-01 §13.4), counted in Redis so every
 * service instance enforces the same budget. A request slot is reserved before calling the model
 * and released again if the user ends up getting nothing.
 */
export class QuotaService {
  constructor(
    private readonly redis: Redis,
    private readonly db: Database,
    readonly limits: QuotaLimits,
  ) {}

  async reserve(userId: string): Promise<Reservation> {
    const day = utcDay();
    const reqKey = aiUsageKey("requests", userId, day);
    const results = await this.redis.multi().incr(reqKey).expire(reqKey, AI_USAGE_TTL_SECONDS).get(aiUsageKey("tokens", userId, day)).exec();
    const used = Number(results?.[0]?.[1] ?? 0);
    const tokens = Number(results?.[2]?.[1] ?? 0);
    if (used > this.limits.requests || tokens >= this.limits.tokens) {
      await this.redis.decr(reqKey);
      return { ok: false, day };
    }
    return { ok: true, day, used };
  }

  async release(userId: string, day: string): Promise<void> {
    await this.redis.decr(aiUsageKey("requests", userId, day));
  }

  /** Records spent tokens; returns how many requests the user has left today. */
  async addTokens(userId: string, day: string, tokens: number): Promise<number> {
    const tokKey = aiUsageKey("tokens", userId, day);
    const results = await this.redis.multi().incrby(tokKey, tokens).expire(tokKey, AI_USAGE_TTL_SECONDS).get(aiUsageKey("requests", userId, day)).exec();
    const usedTokens = Number(results?.[0]?.[1] ?? 0);
    const usedRequests = Number(results?.[2]?.[1] ?? 0);
    return usedTokens >= this.limits.tokens ? 0 : Math.max(0, this.limits.requests - usedRequests);
  }

  /** Durable per-agent usage for reporting and per-agent budgets. */
  async record(row: { userId: string; agentId: string; productId: string | null; day: string; inputTokens: number; outputTokens: number }): Promise<void> {
    await this.db
      .insert(agentUsage)
      .values({ userId: row.userId, agentId: row.agentId, productId: row.productId, periodStart: row.day, requests: 1, inputTokens: row.inputTokens, outputTokens: row.outputTokens })
      .onConflictDoUpdate({
        target: [agentUsage.userId, agentUsage.agentId, agentUsage.productId, agentUsage.periodStart],
        set: {
          requests: sql`${agentUsage.requests} + 1`,
          inputTokens: sql`${agentUsage.inputTokens} + ${row.inputTokens}`,
          outputTokens: sql`${agentUsage.outputTokens} + ${row.outputTokens}`,
        },
      });
  }

  async usage(userId: string, at = new Date()): Promise<AiUsageView> {
    const day = utcDay(at);
    const [requests, tokens] = await this.redis.mget(aiUsageKey("requests", userId, day), aiUsageKey("tokens", userId, day));
    const usedRequests = Math.min(Number(requests ?? 0), this.limits.requests);
    const usedTokens = Math.min(Number(tokens ?? 0), this.limits.tokens);
    const tokensLeft = this.limits.tokens - usedTokens;
    return {
      day,
      requests: { used: usedRequests, limit: this.limits.requests, remaining: tokensLeft > 0 ? this.limits.requests - usedRequests : 0 },
      tokens: { used: usedTokens, limit: this.limits.tokens, remaining: tokensLeft },
      resetsAt: nextUtcMidnight(at).toISOString(),
    };
  }
}
