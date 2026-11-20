import { and, asc, eq } from "drizzle-orm";
import { aiAgents, aiProducts, marketShops, type AgentModelConfig, type AgentPersona, type Database } from "@entroworld/database";

export interface AgentRecord {
  id: string;
  name: string;
  version: number;
  persona: AgentPersona;
  systemPrompt: string;
  modelConfig: AgentModelConfig;
  safetyProfile: string;
  shopSlug: string;
  shopName: string;
  /** False when the agent or its shop is switched off (draft, suspended, inactive). */
  available: boolean;
  /** The product usage is billed to (the agent's chat product). */
  chatProductId: string | null;
}

const TTL_MS = 30_000;

/** Loads agent configurations (SPEC-ADDENDUM-01 §10.2 "Agent Registry"), cached briefly. */
export class AgentRegistry {
  private readonly cache = new Map<string, { at: number; record: AgentRecord | null }>();

  constructor(private readonly db: Database) {}

  async get(agentId: string): Promise<AgentRecord | null> {
    const hit = this.cache.get(agentId);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.record;
    const record = await this.load(agentId);
    this.cache.set(agentId, { at: Date.now(), record });
    return record;
  }

  /** The agent of a shop (each shop has at most one), e.g. Byte of Code Corner. */
  async byShop(shopSlug: string): Promise<AgentRecord | null> {
    const key = `shop:${shopSlug}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.record;
    const [row] = await this.db
      .select({ id: aiAgents.id })
      .from(aiAgents)
      .innerJoin(marketShops, eq(marketShops.id, aiAgents.shopId))
      .where(eq(marketShops.slug, shopSlug))
      .limit(1);
    const record = row ? await this.get(row.id) : null;
    this.cache.set(key, { at: Date.now(), record });
    return record;
  }

  /** Id of one of the agent's active products, by slug. */
  async productId(agentId: string, slug: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: aiProducts.id })
      .from(aiProducts)
      .where(and(eq(aiProducts.agentId, agentId), eq(aiProducts.slug, slug), eq(aiProducts.isActive, true)))
      .limit(1);
    return row?.id ?? null;
  }

  invalidate(agentId?: string): void {
    if (agentId) this.cache.delete(agentId);
    else this.cache.clear();
  }

  private async load(agentId: string): Promise<AgentRecord | null> {
    const [row] = await this.db
      .select({ agent: aiAgents, shop: { slug: marketShops.slug, name: marketShops.name, status: marketShops.status } })
      .from(aiAgents)
      .innerJoin(marketShops, eq(marketShops.id, aiAgents.shopId))
      .where(eq(aiAgents.id, agentId))
      .limit(1);
    if (!row) return null;
    const [product] = await this.db
      .select({ id: aiProducts.id })
      .from(aiProducts)
      .where(and(eq(aiProducts.agentId, agentId), eq(aiProducts.productType, "chat"), eq(aiProducts.isActive, true)))
      .orderBy(asc(aiProducts.createdAt))
      .limit(1);
    const a = row.agent;
    return {
      id: a.id,
      name: a.name,
      version: a.version,
      persona: a.persona,
      systemPrompt: a.systemPrompt,
      modelConfig: a.modelConfig,
      safetyProfile: a.safetyProfile,
      shopSlug: row.shop.slug,
      shopName: row.shop.name,
      available: a.isActive && row.shop.status === "active",
      chatProductId: product?.id ?? null,
    };
  }
}
