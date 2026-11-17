/** Public, client-facing shapes of the AI marketplace API. System prompts and model settings never appear here. */

export type ShopStatus = "draft" | "in_review" | "active" | "suspended";
export type ProductType = "chat" | "tool" | "subscription";
export type AgentSenderType = "user" | "agent" | "system";
export type ModerationStatus = "ok" | "flagged" | "blocked";

export interface AgentPersonaView {
  id: string;
  shopSlug: string;
  name: string;
  /** One line about what the agent helps with. */
  specialty: string;
  personality: string;
  greeting: string;
  /** Seed for the shopkeeper's generated avatar. */
  avatarSeed: string;
  disclaimer: string | null;
}

export interface ProductView {
  id: string;
  agentId: string;
  name: string;
  description: string;
  productType: ProductType;
  /** Free requests per day. */
  freeQuota: number;
}

export interface ShopView {
  id: string;
  slug: string;
  name: string;
  description: string;
  zoneId: string;
  status: ShopStatus;
  agent: AgentPersonaView | null;
}

export interface ShopDetailView extends ShopView {
  products: ProductView[];
}

export interface AgentConversationView {
  id: string;
  agent: AgentPersonaView;
  isGroup: boolean;
  createdAt: string;
  lastMessageAt: string;
  /** Start of the latest message, for conversation lists. */
  preview: string | null;
}

export interface AgentMessageView {
  id: string;
  conversationId: string;
  senderType: AgentSenderType;
  senderUserId: string | null;
  /** Null when moderation removed the message. */
  content: string | null;
  moderationStatus: ModerationStatus;
  createdAt: string;
}

export interface AiUsageView {
  /** UTC day the counters belong to (YYYY-MM-DD). */
  day: string;
  requests: { used: number; limit: number; remaining: number };
  tokens: { used: number; limit: number; remaining: number };
  resetsAt: string;
}
