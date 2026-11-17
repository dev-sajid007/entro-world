import { randomUUID } from "node:crypto";
import type { Redis } from "ioredis";
import { and, desc, eq, isNull, ne, sql } from "drizzle-orm";
import {
  agentConversationMembers,
  agentConversations,
  agentMessages,
  isUniqueViolation,
  type Database,
  type ModerationRowStatus,
} from "@entroworld/database";
import type { ChatTurn } from "../providers/types";

/** How much earlier conversation is sent to the model with each message. */
const HISTORY_MESSAGES = 24;
const HISTORY_CHARS = 16_000;
/** A crashed request releases its conversation lock after this long. */
const LOCK_SECONDS = 120;

export interface ConversationRef {
  id: string;
  agentId: string;
}

export interface StoredMessage {
  id: string;
  content: string;
  moderationStatus: ModerationRowStatus;
}

/** Conversation persistence and history trimming (SPEC-ADDENDUM-01 §10.2 "Conversation Manager"). */
export class ConversationStore {
  constructor(
    private readonly db: Database,
    private readonly redis: Redis,
  ) {}

  /** The conversation, if the user started it or was invited to it and it isn't deleted. */
  async access(conversationId: string, userId: string): Promise<ConversationRef | null> {
    const [row] = await this.db
      .select({ id: agentConversations.id, agentId: agentConversations.agentId })
      .from(agentConversations)
      .where(
        and(
          eq(agentConversations.id, conversationId),
          isNull(agentConversations.deletedAt),
          sql`(${agentConversations.userId} = ${userId} or exists (select 1 from ${agentConversationMembers} m where m.conversation_id = ${agentConversations.id} and m.user_id = ${userId}))`,
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findUserMessage(conversationId: string, clientMessageId: string): Promise<StoredMessage | null> {
    const [row] = await this.db
      .select({ id: agentMessages.id, content: agentMessages.content, moderationStatus: agentMessages.moderationStatus })
      .from(agentMessages)
      .where(and(eq(agentMessages.conversationId, conversationId), eq(agentMessages.clientMessageId, clientMessageId)))
      .limit(1);
    return row ?? null;
  }

  async findReply(userMessageId: string): Promise<StoredMessage | null> {
    const [row] = await this.db
      .select({ id: agentMessages.id, content: agentMessages.content, moderationStatus: agentMessages.moderationStatus })
      .from(agentMessages)
      .where(and(eq(agentMessages.replyToId, userMessageId), eq(agentMessages.senderType, "agent")))
      .limit(1);
    return row ?? null;
  }

  /** Inserts the user's message; a concurrent duplicate (same client id) returns the existing row. */
  async addUserMessage(c: ConversationRef, userId: string, content: string, clientMessageId: string, status: ModerationRowStatus): Promise<string> {
    try {
      const [row] = await this.db
        .insert(agentMessages)
        .values({ conversationId: c.id, senderType: "user", senderUserId: userId, content, clientMessageId, moderationStatus: status })
        .returning({ id: agentMessages.id });
      await this.touch(c.id);
      return row!.id;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const existing = await this.findUserMessage(c.id, clientMessageId);
      if (!existing) throw e;
      return existing.id;
    }
  }

  async addAgentMessage(c: ConversationRef, m: { content: string; tokenCount: number; status: ModerationRowStatus; replyToId: string }): Promise<string> {
    const [row] = await this.db
      .insert(agentMessages)
      .values({ conversationId: c.id, senderType: "agent", content: m.content, tokenCount: m.tokenCount, moderationStatus: m.status, replyToId: m.replyToId })
      .returning({ id: agentMessages.id });
    await this.touch(c.id);
    return row!.id;
  }

  /**
   * Recent clean messages before `excludeId`, oldest first, trimmed to a size budget and starting
   * with a user turn (the model requires that). Flagged and blocked messages are left out so
   * injection attempts never become context.
   */
  async history(conversationId: string, excludeId: string): Promise<ChatTurn[]> {
    const rows = await this.db
      .select({ senderType: agentMessages.senderType, content: agentMessages.content })
      .from(agentMessages)
      .where(and(eq(agentMessages.conversationId, conversationId), eq(agentMessages.moderationStatus, "ok"), ne(agentMessages.id, excludeId), ne(agentMessages.senderType, "system")))
      .orderBy(desc(agentMessages.createdAt), desc(agentMessages.id))
      .limit(HISTORY_MESSAGES);
    const turns: ChatTurn[] = [];
    let chars = 0;
    for (const r of rows) {
      chars += r.content.length;
      if (chars > HISTORY_CHARS) break;
      turns.unshift({ role: r.senderType === "agent" ? "assistant" : "user", content: r.content });
    }
    while (turns[0]?.role === "assistant") turns.shift();
    return turns;
  }

  /** One answer at a time per conversation. Returns a release function, or null if busy. */
  async lock(conversationId: string): Promise<(() => Promise<void>) | null> {
    const key = `ew:ai:busy:${conversationId}`;
    const token = randomUUID();
    const ok = await this.redis.set(key, token, "EX", LOCK_SECONDS, "NX");
    if (ok !== "OK") return null;
    return async () => {
      await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token);
    };
  }

  private async touch(conversationId: string): Promise<void> {
    await this.db.update(agentConversations).set({ lastMessageAt: new Date() }).where(eq(agentConversations.id, conversationId));
  }
}
