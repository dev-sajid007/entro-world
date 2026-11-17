import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type {
  AgentConversationView,
  AgentMessageView,
  AgentPersonaView,
  ProductView,
  ShopDetailView,
  ShopView,
} from "@entroworld/agent-protocol";
import {
  agentConversationMembers,
  agentConversations,
  agentMessages,
  aiAgents,
  aiProducts,
  isUniqueViolation,
  marketShops,
  moderationReports,
} from "@entroworld/database";
import type { PageQuery, ReportInput } from "@entroworld/validation";
import type { AppContext } from "../../context";
import { decodeCursor, page } from "../../lib/cursor";
import { conflict, notFound } from "../../lib/errors";

type AgentRow = typeof aiAgents.$inferSelect;
type ShopRow = typeof marketShops.$inferSelect;

/** Public persona only: the system prompt and model settings never leave the server. */
function personaView(agent: AgentRow, shopSlug: string): AgentPersonaView {
  return {
    id: agent.id,
    shopSlug,
    name: agent.name,
    specialty: agent.persona.specialty,
    personality: agent.persona.personality,
    greeting: agent.persona.greeting,
    avatarSeed: agent.persona.avatarSeed,
    disclaimer: agent.persona.disclaimer ?? null,
  };
}

function shopView(shop: ShopRow, agent: AgentRow | null): ShopView {
  return {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    description: shop.description,
    zoneId: shop.zoneId,
    status: shop.status,
    agent: agent && agent.isActive && shop.status === "active" ? personaView(agent, shop.slug) : null,
  };
}

const productView = (p: typeof aiProducts.$inferSelect): ProductView => ({
  id: p.id,
  agentId: p.agentId,
  name: p.name,
  description: p.description,
  productType: p.productType,
  freeQuota: p.freeQuota,
});

/** Conversations the user started or was invited to. */
const participant = (userId: string) =>
  or(
    eq(agentConversations.userId, userId),
    sql`exists (select 1 from ${agentConversationMembers} m where m.conversation_id = ${agentConversations.id} and m.user_id = ${userId})`,
  );

export class MarketService {
  constructor(private readonly ctx: AppContext) {}

  private get db() {
    return this.ctx.db;
  }

  /** Every shop on AI Agent Street except suspended ones (closed storefronts have no agent yet). */
  async shops(): Promise<ShopView[]> {
    const rows = await this.db
      .select({ shop: marketShops, agent: aiAgents })
      .from(marketShops)
      .leftJoin(aiAgents, eq(aiAgents.shopId, marketShops.id))
      .where(ne(marketShops.status, "suspended"))
      .orderBy(asc(marketShops.name));
    return rows.map((r) => shopView(r.shop, r.agent));
  }

  async shop(slug: string): Promise<ShopDetailView> {
    const [row] = await this.db
      .select({ shop: marketShops, agent: aiAgents })
      .from(marketShops)
      .leftJoin(aiAgents, eq(aiAgents.shopId, marketShops.id))
      .where(and(eq(marketShops.slug, slug), ne(marketShops.status, "suspended")))
      .limit(1);
    if (!row) throw notFound("Shop");
    const view = shopView(row.shop, row.agent);
    return { ...view, products: view.agent ? await this.productsOf(view.agent.id) : [] };
  }

  async products(slug: string): Promise<ProductView[]> {
    return (await this.shop(slug)).products;
  }

  private async productsOf(agentId: string): Promise<ProductView[]> {
    const rows = await this.db
      .select()
      .from(aiProducts)
      .where(and(eq(aiProducts.agentId, agentId), eq(aiProducts.isActive, true)))
      .orderBy(asc(aiProducts.createdAt));
    return rows.map(productView);
  }

  /** An agent that is open for business, with its shop. */
  private async activeAgent(agentId: string): Promise<{ agent: AgentRow; shop: ShopRow }> {
    const [row] = await this.db
      .select({ agent: aiAgents, shop: marketShops })
      .from(aiAgents)
      .innerJoin(marketShops, eq(marketShops.id, aiAgents.shopId))
      .where(eq(aiAgents.id, agentId))
      .limit(1);
    if (!row || row.shop.status === "suspended") throw notFound("Agent");
    if (!row.agent.isActive || row.shop.status !== "active") throw conflict(`${row.shop.name} is closed right now.`, "shop_closed");
    return row;
  }

  async agent(agentId: string): Promise<AgentPersonaView> {
    const { agent, shop } = await this.activeAgent(agentId);
    return personaView(agent, shop.slug);
  }

  async createConversation(userId: string, agentId: string): Promise<AgentConversationView> {
    const { agent, shop } = await this.activeAgent(agentId);
    const [row] = await this.db.insert(agentConversations).values({ agentId, userId }).returning();
    return {
      id: row!.id,
      agent: personaView(agent, shop.slug),
      isGroup: row!.isGroup,
      createdAt: row!.createdAt.toISOString(),
      lastMessageAt: row!.lastMessageAt.toISOString(),
      preview: null,
    };
  }

  async conversations(userId: string, query: PageQuery & { agentId?: string | undefined }): Promise<{ items: AgentConversationView[]; nextCursor: string | null }> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db
      .select({ conversation: agentConversations, agent: aiAgents, shopSlug: marketShops.slug })
      .from(agentConversations)
      .innerJoin(aiAgents, eq(aiAgents.id, agentConversations.agentId))
      .innerJoin(marketShops, eq(marketShops.id, aiAgents.shopId))
      .where(
        and(
          participant(userId),
          isNull(agentConversations.deletedAt),
          query.agentId ? eq(agentConversations.agentId, query.agentId) : undefined,
          cursor
            ? sql`(${agentConversations.lastMessageAt}, ${agentConversations.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(agentConversations.lastMessageAt), desc(agentConversations.id))
      .limit(query.limit + 1);
    const { items, nextCursor } = page(
      rows.map((r) => ({ ...r, id: r.conversation.id, createdAt: r.conversation.lastMessageAt })),
      query.limit,
    );
    const previews = await this.previews(items.map((r) => r.id));
    return {
      items: items.map((r) => ({
        id: r.conversation.id,
        agent: personaView(r.agent, r.shopSlug),
        isGroup: r.conversation.isGroup,
        createdAt: r.conversation.createdAt.toISOString(),
        lastMessageAt: r.conversation.lastMessageAt.toISOString(),
        preview: previews.get(r.id) ?? null,
      })),
      nextCursor,
    };
  }

  private async previews(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .selectDistinctOn([agentMessages.conversationId], { conversationId: agentMessages.conversationId, content: agentMessages.content })
      .from(agentMessages)
      .where(and(inArray(agentMessages.conversationId, ids), ne(agentMessages.moderationStatus, "blocked")))
      .orderBy(agentMessages.conversationId, desc(agentMessages.createdAt), desc(agentMessages.id));
    return new Map(rows.map((r) => [r.conversationId, r.content.length > 120 ? `${r.content.slice(0, 117)}…` : r.content]));
  }

  /** The conversation if the user may use it; 404 otherwise (no hint that it exists). */
  async requireConversation(userId: string, conversationId: string): Promise<{ id: string; agentId: string; ownerId: string }> {
    const [row] = await this.db
      .select({ id: agentConversations.id, agentId: agentConversations.agentId, ownerId: agentConversations.userId })
      .from(agentConversations)
      .where(and(eq(agentConversations.id, conversationId), isNull(agentConversations.deletedAt), participant(userId)))
      .limit(1);
    if (!row) throw notFound("Conversation");
    return row;
  }

  /** Messages newest first; content removed by moderation is returned as null. */
  async messages(userId: string, conversationId: string, query: PageQuery): Promise<{ items: AgentMessageView[]; nextCursor: string | null }> {
    await this.requireConversation(userId, conversationId);
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db
      .select()
      .from(agentMessages)
      .where(
        and(
          eq(agentMessages.conversationId, conversationId),
          cursor ? sql`(${agentMessages.createdAt}, ${agentMessages.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)` : undefined,
        ),
      )
      .orderBy(desc(agentMessages.createdAt), desc(agentMessages.id))
      .limit(query.limit + 1);
    const { items, nextCursor } = page(rows, query.limit);
    return {
      items: items.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        senderType: m.senderType,
        senderUserId: m.senderUserId,
        content: m.moderationStatus === "blocked" ? null : m.content,
        moderationStatus: m.moderationStatus,
        createdAt: m.createdAt.toISOString(),
      })),
      nextCursor,
    };
  }

  /** Soft-deletes a conversation the user started (SPEC-ADDENDUM-01 §11). */
  async deleteConversation(userId: string, conversationId: string): Promise<void> {
    const c = await this.requireConversation(userId, conversationId);
    if (c.ownerId !== userId) throw notFound("Conversation");
    await this.db.update(agentConversations).set({ deletedAt: new Date() }).where(eq(agentConversations.id, conversationId));
  }

  /** Reports a message in a conversation the user takes part in; repeating an open report is a no-op. */
  async reportMessage(userId: string, messageId: string, input: ReportInput): Promise<void> {
    const [message] = await this.db
      .select({ conversationId: agentMessages.conversationId, senderType: agentMessages.senderType, senderUserId: agentMessages.senderUserId })
      .from(agentMessages)
      .where(eq(agentMessages.id, messageId))
      .limit(1);
    if (!message) throw notFound("Message");
    try {
      await this.requireConversation(userId, message.conversationId);
    } catch {
      throw notFound("Message");
    }
    try {
      await this.db.insert(moderationReports).values({
        reporterId: userId,
        targetType: "agent_message",
        targetUserId: message.senderType === "user" ? message.senderUserId : null,
        targetContentId: messageId,
        reason: input.reason,
        details: input.details,
      });
    } catch (e) {
      if (!isUniqueViolation(e, "moderation_reports_dedupe")) throw e;
    }
  }
}
