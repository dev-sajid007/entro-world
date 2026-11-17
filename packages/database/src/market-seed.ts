import { and, eq, lt } from "drizzle-orm";
import { getCityLayout } from "@entroworld/world-assets";
import type { DbExecutor } from "./client";
import { aiAgents, aiProducts, marketShops, type AgentModelConfig, type AgentPersona, type ShopRowStatus } from "./schema";

/**
 * Platform-owned shops of AI Agent Street. Shops without an agent stay in "draft" (closed
 * storefronts) until their agent launches; their buildings already exist in the city layout.
 */
const SHOP_DESCRIPTIONS: Record<string, string> = {
  "code-corner": "Coding mentor: code help, debugging and clear explanations of programming concepts.",
  "design-studio": "Creative assistant: logo, poster and color ideas.",
  "book-cafe": "Librarian: book recommendations and story summaries.",
  "language-school": "Conversation partner for language practice.",
  "career-office": "Career coach: CV review and mock interviews.",
  "travel-agency": "Travel planner for trip ideas and itineraries.",
  "wellness-corner": "General fitness and wellbeing tips (not medical advice).",
};

interface AgentSeed {
  shopSlug: string;
  /** Bump to roll out persona or prompt changes; existing rows with a lower version are updated. */
  version: number;
  name: string;
  persona: AgentPersona;
  systemPrompt: string;
  modelConfig: AgentModelConfig;
  safetyProfile: string;
  products: { slug: string; name: string; description: string; productType: "chat" | "tool" | "subscription"; freeQuota: number }[];
}

const AGENTS: AgentSeed[] = [
  {
    shopSlug: "code-corner",
    version: 1,
    name: "Byte",
    persona: {
      personality: "A patient, upbeat coding mentor who loves turning bugs into lessons.",
      greeting: "Hi there! I'm Byte, the mentor at Code Corner. Stuck on a bug, curious about a concept, or just getting started? Ask me anything about code.",
      speakingStyle: "Friendly and concise. Short paragraphs, small code examples, and a guiding question when it helps the learner think.",
      specialty: "Code help and clear explanations of programming concepts",
      avatarSeed: "code-corner-byte",
      quotaMessage: "We've covered a lot today! You've used all of today's free questions, so let's pick this up tomorrow. Keep practicing in the meantime.",
    },
    systemPrompt: [
      "You are Byte, the shopkeeper of Code Corner, a programming help shop on AI Agent Street in the virtual city of EntroWorld.",
      "",
      "What you do:",
      "- Help visitors understand programming: explain concepts, read their code, find bugs, and suggest how to improve it.",
      "- Prefer teaching over doing. For learning questions, explain the idea and give a hint or a small example, then let the visitor try. Give a complete solution when they ask for one directly or are clearly stuck after trying.",
      "- Any language is fine; JavaScript, TypeScript and Python are the most common here.",
      "",
      "How you talk:",
      "- Warm, encouraging and brief: usually under 150 words. Visitors read your replies in a small chat panel in a 3D world, so keep paragraphs short.",
      "- Use Markdown code blocks for code, and keep examples small.",
      "- If a question is vague, ask one short clarifying question.",
      "",
      "Scope: you are a coding mentor. For topics far from programming, say briefly that it's outside what you do at Code Corner and suggest another shop on the street might help.",
    ].join("\n"),
    modelConfig: { maxTokens: 4096, effort: "low" },
    safetyProfile: "standard",
    products: [
      {
        slug: "code-help",
        name: "Code Help Chat",
        description: "Ask Byte about any programming question, paste code to get it explained or debugged.",
        productType: "chat",
        freeQuota: 20,
      },
    ],
  },
];

/** Idempotently creates the AI Agent Street shops, their agents and products. */
export async function seedMarket(db: DbExecutor): Promise<void> {
  const layout = getCityLayout();
  const agentShops = new Set(AGENTS.map((a) => a.shopSlug));
  const shopIds = new Map<string, string>();
  for (const shop of layout.shops) {
    const status: ShopRowStatus = agentShops.has(shop.slug) && shop.open ? "active" : "draft";
    const values = {
      zoneId: shop.zoneId,
      slug: shop.slug,
      name: shop.name,
      description: SHOP_DESCRIPTIONS[shop.slug] ?? "",
      position: { x: shop.x, z: shop.z, rotation: shop.rotation },
      interiorConfig: shop.open ? { keeper: shop.keeper, trigger: shop.trigger } : {},
    };
    const [row] = await db
      .insert(marketShops)
      .values({ ...values, status })
      // Status is only set on creation: moderators may suspend a shop, and re-seeding must not undo that.
      .onConflictDoUpdate({ target: marketShops.slug, set: values })
      .returning({ id: marketShops.id });
    shopIds.set(shop.slug, row!.id);
  }

  for (const seed of AGENTS) {
    const shopId = shopIds.get(seed.shopSlug);
    if (!shopId) throw new Error(`Agent ${seed.name} references unknown shop ${seed.shopSlug}`);
    const values = {
      shopId,
      name: seed.name,
      persona: seed.persona,
      systemPrompt: seed.systemPrompt,
      modelConfig: seed.modelConfig,
      safetyProfile: seed.safetyProfile,
      version: seed.version,
    };
    await db.insert(aiAgents).values(values).onConflictDoNothing({ target: aiAgents.shopId });
    await db
      .update(aiAgents)
      .set(values)
      .where(and(eq(aiAgents.shopId, shopId), lt(aiAgents.version, seed.version)));
    const [agent] = await db.select({ id: aiAgents.id }).from(aiAgents).where(eq(aiAgents.shopId, shopId)).limit(1);
    for (const p of seed.products) {
      await db
        .insert(aiProducts)
        .values({ agentId: agent!.id, ...p })
        .onConflictDoUpdate({
          target: [aiProducts.agentId, aiProducts.slug],
          set: { name: p.name, description: p.description, productType: p.productType, freeQuota: p.freeQuota },
        });
    }
  }
}
