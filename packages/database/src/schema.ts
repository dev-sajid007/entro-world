import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type {
  AvatarConfig,
  MediaType,
  PostType,
  PostVisibility,
  PrivacySetting,
  ReactionType,
  UserRole,
  UserStatus,
  WorldLocation,
  ZoneId,
} from "@entroworld/shared";
import type { BadgeCriteria, EditorMode, LessonContent, LessonStatus, PuzzleDefinition, TrackLevel } from "@entroworld/robot-api";

// Conventions: UUID primary keys, timestamptz everywhere, soft deletion via `deleted_at` where
// content may need to be restored or audited. Enumerations are varchar + CHECK constraints so new
// values only need a migration of the constraint, not of a Postgres enum type.

const pk = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const oneOf = (column: AnyPgColumn, values: readonly string[]) => sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(", "))})`;

export const FRIENDSHIP_STATUSES = ["pending", "accepted"] as const;
export type FriendshipRowStatus = (typeof FRIENDSHIP_STATUSES)[number];
export const REPORT_STATUSES = ["open", "reviewing", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export const REPORT_TARGETS = ["user", "post", "comment", "agent_message"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];
export const SHOP_STATUSES = ["draft", "in_review", "active", "suspended"] as const;
export type ShopRowStatus = (typeof SHOP_STATUSES)[number];
export const SHOP_OWNER_TYPES = ["platform", "partner"] as const;
export type ShopOwnerType = (typeof SHOP_OWNER_TYPES)[number];
export const PRODUCT_TYPES = ["chat", "tool", "subscription"] as const;
export type ProductRowType = (typeof PRODUCT_TYPES)[number];
export const AGENT_SENDER_TYPES = ["user", "agent", "system"] as const;
export type AgentSenderRowType = (typeof AGENT_SENDER_TYPES)[number];
export const MODERATION_STATUSES = ["ok", "flagged", "blocked"] as const;
export type ModerationRowStatus = (typeof MODERATION_STATUSES)[number];
export const TRACK_LEVELS = ["beginner", "intermediate", "advanced"] as const satisfies readonly TrackLevel[];
export const LESSON_STATUSES = ["not_started", "in_progress", "completed"] as const satisfies readonly LessonStatus[];
export const EDITOR_MODE_VALUES = ["blocks", "split", "code"] as const satisfies readonly EditorMode[];
export const EMAIL_TOKEN_PURPOSES = ["verify_email"] as const;
export type EmailTokenPurpose = (typeof EMAIL_TOKEN_PURPOSES)[number];

// -------------------------------------------------------------------------------------------------
// Identity
// -------------------------------------------------------------------------------------------------

export const users = pgTable(
  "users",
  {
    id: pk(),
    /** Stored as entered; uniqueness and lookups are case-insensitive. */
    email: varchar("email", { length: 254 }).notNull(),
    username: varchar("username", { length: 24 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: varchar("display_name", { length: 48 }).notNull(),
    role: varchar("role", { length: 16 }).$type<UserRole>().notNull().default("user"),
    status: varchar("status", { length: 16 }).$type<UserStatus>().notNull().default("active"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("users_email_lower_unique").on(sql`lower(${t.email})`),
    uniqueIndex("users_username_lower_unique").on(sql`lower(${t.username})`),
    index("users_display_name_lower_idx").on(sql`lower(${t.displayName})`),
    check("users_role_check", oneOf(t.role, ["user", "moderator", "admin"])),
    check("users_status_check", oneOf(t.status, ["active", "suspended", "banned"])),
  ],
);

export const profiles = pgTable(
  "profiles",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bio: text("bio").notNull().default(""),
    avatarUrl: text("avatar_url"),
    coverUrl: text("cover_url"),
    privacy: varchar("privacy", { length: 16 }).$type<PrivacySetting>().notNull().default("public"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("profiles_user_unique").on(t.userId), check("profiles_privacy_check", oneOf(t.privacy, ["public", "friends", "private"]))],
);

export const avatars = pgTable(
  "avatars",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    modelId: varchar("model_id", { length: 40 }).notNull(),
    appearance: jsonb("appearance").$type<AvatarConfig["appearance"]>().notNull(),
    clothing: jsonb("clothing").$type<AvatarConfig["clothing"]>().notNull(),
    accessories: jsonb("accessories").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("avatars_user_unique").on(t.userId)],
);

/**
 * Refresh-token sessions. Each refresh rotates the token: a new row joins the same family and the
 * old row is revoked with `replaced_by_id`. Presenting a replaced token again means it leaked, so
 * the whole family is revoked. A "session" from the user's point of view is a family.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    /** SHA-256 of the opaque refresh token; the token itself is never stored. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    userAgent: varchar("user_agent", { length: 300 }),
    ip: varchar("ip", { length: 64 }),
    createdAt: createdAt(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    replacedById: uuid("replaced_by_id"),
  },
  (t) => [uniqueIndex("sessions_token_hash_unique").on(t.tokenHash), index("sessions_user_idx").on(t.userId), index("sessions_family_idx").on(t.familyId)],
);

export const emailTokens = pgTable(
  "email_tokens",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: varchar("purpose", { length: 24 }).$type<EmailTokenPurpose>().notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("email_tokens_hash_unique").on(t.tokenHash), index("email_tokens_user_idx").on(t.userId, t.purpose)],
);

// -------------------------------------------------------------------------------------------------
// World
// -------------------------------------------------------------------------------------------------

export const worlds = pgTable("worlds", {
  id: pk(),
  slug: varchar("slug", { length: 40 }).notNull().unique(),
  name: varchar("name", { length: 80 }).notNull(),
  createdAt: createdAt(),
});

export const worldZones = pgTable(
  "world_zones",
  {
    id: pk(),
    worldId: uuid("world_id")
      .notNull()
      .references(() => worlds.id, { onDelete: "cascade" }),
    /** The zone identifier used throughout the code (e.g. "zone-central"). */
    slug: varchar("slug", { length: 40 }).$type<ZoneId>().notNull().unique(),
    name: varchar("name", { length: 80 }).notNull(),
    description: text("description").notNull().default(""),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("world_zones_world_idx").on(t.worldId)],
);

/** Live multiplayer rooms, maintained by the game servers (zone ids reference `world_zones.slug`). */
export const worldInstances = pgTable(
  "world_instances",
  {
    id: pk(),
    zoneId: varchar("zone_id", { length: 40 })
      .$type<ZoneId>()
      .notNull()
      .references(() => worldZones.slug),
    roomId: varchar("room_id", { length: 64 }).notNull(),
    serverId: varchar("server_id", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).$type<"open" | "closed">().notNull().default("open"),
    currentPlayers: integer("current_players").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("world_instances_room_unique").on(t.roomId),
    index("world_instances_zone_status_idx").on(t.zoneId, t.status),
    check("world_instances_status_check", oneOf(t.status, ["open", "closed"])),
  ],
);

/** Last known position, persisted on controlled transitions and periodically (never per frame). */
export const userWorldState = pgTable("user_world_state", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  zoneId: varchar("zone_id", { length: 40 })
    .$type<ZoneId>()
    .notNull()
    .references(() => worldZones.slug),
  positionX: doublePrecision("position_x").notNull(),
  positionY: doublePrecision("position_y").notNull(),
  positionZ: doublePrecision("position_z").notNull(),
  rotation: doublePrecision("rotation").notNull().default(0),
  updatedAt: updatedAt(),
});

// -------------------------------------------------------------------------------------------------
// Social graph
// -------------------------------------------------------------------------------------------------

export const friendships = pgTable(
  "friendships",
  {
    id: pk(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addresseeId: uuid("addressee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 }).$type<FriendshipRowStatus>().notNull().default("pending"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One row per pair, whoever asked first.
    uniqueIndex("friendships_pair_unique").on(sql`least(${t.requesterId}, ${t.addresseeId})`, sql`greatest(${t.requesterId}, ${t.addresseeId})`),
    index("friendships_addressee_idx").on(t.addresseeId, t.status),
    index("friendships_requester_idx").on(t.requesterId, t.status),
    check("friendships_not_self", sql`${t.requesterId} <> ${t.addresseeId}`),
    check("friendships_status_check", oneOf(t.status, FRIENDSHIP_STATUSES)),
  ],
);

export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    followeeId: uuid("followee_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followeeId] }), index("follows_followee_idx").on(t.followeeId), check("follows_not_self", sql`${t.followerId} <> ${t.followeeId}`)],
);

export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index("blocks_blocked_idx").on(t.blockedId), check("blocks_not_self", sql`${t.blockerId} <> ${t.blockedId}`)],
);

// -------------------------------------------------------------------------------------------------
// Content
// -------------------------------------------------------------------------------------------------

export const posts = pgTable(
  "posts",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull().default(""),
    visibility: varchar("visibility", { length: 16 }).$type<PostVisibility>().notNull().default("public"),
    postType: varchar("post_type", { length: 16 }).$type<PostType>().notNull().default("text"),
    location: jsonb("location").$type<WorldLocation>(),
    sharedPostId: uuid("shared_post_id").references((): AnyPgColumn => posts.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("posts_user_created_idx").on(t.userId, t.createdAt.desc(), t.id.desc()),
    index("posts_created_idx").on(t.createdAt.desc(), t.id.desc()),
    index("posts_shared_idx").on(t.sharedPostId),
    check("posts_visibility_check", oneOf(t.visibility, ["public", "friends", "private"])),
    check("posts_type_check", oneOf(t.postType, ["text", "image", "video", "location", "event", "share"])),
  ],
);

/** Media lives in object storage; rows only hold its URL and metadata. */
export const postMedia = pgTable(
  "post_media",
  {
    id: pk(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    mediaUrl: text("media_url").notNull(),
    mediaType: varchar("media_type", { length: 16 }).$type<MediaType>().notNull(),
    metadata: jsonb("metadata").$type<{ width?: number; height?: number; bytes?: number }>().notNull().default(sql`'{}'::jsonb`),
    position: integer("position").notNull().default(0),
  },
  (t) => [index("post_media_post_idx").on(t.postId, t.position), check("post_media_type_check", oneOf(t.mediaType, ["image", "video"]))],
);

export const comments = pgTable(
  "comments",
  {
    id: pk(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("comments_post_created_idx").on(t.postId, t.createdAt, t.id)],
);

export const reactions = pgTable(
  "reactions",
  {
    id: pk(),
    postId: uuid("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reactionType: varchar("reaction_type", { length: 16 }).$type<ReactionType>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("reactions_unique").on(t.postId, t.userId, t.reactionType),
    index("reactions_user_type_idx").on(t.userId, t.reactionType, t.createdAt.desc()),
    check("reactions_type_check", oneOf(t.reactionType, ["like", "save"])),
  ],
);

// -------------------------------------------------------------------------------------------------
// Moderation
// -------------------------------------------------------------------------------------------------

export const moderationReports = pgTable(
  "moderation_reports",
  {
    id: pk(),
    reporterId: uuid("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetUserId: uuid("target_user_id").references(() => users.id, { onDelete: "set null" }),
    targetType: varchar("target_type", { length: 16 }).$type<ReportTarget>().notNull(),
    targetContentId: uuid("target_content_id"),
    reason: varchar("reason", { length: 32 }).notNull(),
    details: text("details").notNull().default(""),
    status: varchar("status", { length: 16 }).$type<ReportStatus>().notNull().default("open"),
    createdAt: createdAt(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedById: uuid("resolved_by_id").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    index("moderation_reports_status_idx").on(t.status, t.createdAt),
    index("moderation_reports_target_idx").on(t.targetType, t.targetContentId),
    // One open report per reporter and target.
    uniqueIndex("moderation_reports_dedupe").on(t.reporterId, t.targetType, sql`coalesce(${t.targetContentId}, ${t.targetUserId})`).where(sql`${t.status} = 'open'`),
    check("moderation_reports_target_check", oneOf(t.targetType, REPORT_TARGETS)),
    check("moderation_reports_status_check", oneOf(t.status, REPORT_STATUSES)),
  ],
);

// -------------------------------------------------------------------------------------------------
// AI Agent Marketplace (SPEC-ADDENDUM-01 §11)
// -------------------------------------------------------------------------------------------------

export interface AgentPersona {
  personality: string;
  greeting: string;
  speakingStyle: string;
  specialty: string;
  /** Seed for the shopkeeper's generated avatar. */
  avatarSeed: string;
  /** Shown with every answer for agents in sensitive areas (wellness, career). */
  disclaimer?: string;
  /** In-character reply when the user's daily allowance is used up. */
  quotaMessage?: string;
}

export interface AgentModelConfig {
  provider?: "anthropic" | "mock";
  /** Defaults to AI_DEFAULT_MODEL. */
  model?: string;
  maxTokens?: number;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
}

export const marketShops = pgTable(
  "market_shops",
  {
    id: pk(),
    zoneId: varchar("zone_id", { length: 40 })
      .$type<ZoneId>()
      .notNull()
      .references(() => worldZones.slug),
    /** Matches the shop's building in the city layout. */
    slug: varchar("slug", { length: 40 }).notNull().unique(),
    name: varchar("name", { length: 80 }).notNull(),
    description: text("description").notNull().default(""),
    position: jsonb("position").$type<{ x: number; z: number; rotation: number }>().notNull(),
    interiorConfig: jsonb("interior_config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ownerType: varchar("owner_type", { length: 16 }).$type<ShopOwnerType>().notNull().default("platform"),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    status: varchar("status", { length: 16 }).$type<ShopRowStatus>().notNull().default("draft"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("market_shops_zone_idx").on(t.zoneId),
    check("market_shops_status_check", oneOf(t.status, SHOP_STATUSES)),
    check("market_shops_owner_type_check", oneOf(t.ownerType, SHOP_OWNER_TYPES)),
  ],
);

export const aiAgents = pgTable(
  "ai_agents",
  {
    id: pk(),
    shopId: uuid("shop_id")
      .notNull()
      .references(() => marketShops.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    persona: jsonb("persona").$type<AgentPersona>().notNull(),
    /** Server-only: never returned to clients. */
    systemPrompt: text("system_prompt").notNull(),
    modelConfig: jsonb("model_config").$type<AgentModelConfig>().notNull().default(sql`'{}'::jsonb`),
    voiceConfig: jsonb("voice_config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    /** Agents have no tools in this phase (SPEC-ADDENDUM-01 §13.2). */
    allowedTools: jsonb("allowed_tools").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    safetyProfile: varchar("safety_profile", { length: 32 }).notNull().default("standard"),
    version: integer("version").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("ai_agents_shop_idx").on(t.shopId)],
);

export const aiProducts = pgTable(
  "ai_products",
  {
    id: pk(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => aiAgents.id, { onDelete: "cascade" }),
    /** Stable identifier for seeding (unique per agent). */
    slug: varchar("slug", { length: 40 }).notNull(),
    name: varchar("name", { length: 80 }).notNull(),
    description: text("description").notNull().default(""),
    productType: varchar("product_type", { length: 16 }).$type<ProductRowType>().notNull().default("chat"),
    /** Free requests per user per day. */
    freeQuota: integer("free_quota").notNull().default(0),
    priceConfig: jsonb("price_config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("ai_products_agent_slug_idx").on(t.agentId, t.slug),
    check("ai_products_type_check", oneOf(t.productType, PRODUCT_TYPES)),
    check("ai_products_free_quota_check", sql`${t.freeQuota} >= 0`),
  ],
);

export const agentConversations = pgTable(
  "agent_conversations",
  {
    id: pk(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => aiAgents.id, { onDelete: "cascade" }),
    /** The user who started the conversation. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    isGroup: boolean("is_group").notNull().default(false),
    memoryEnabled: boolean("memory_enabled").notNull().default(false),
    createdAt: createdAt(),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("agent_conversations_user_idx").on(t.userId, t.lastMessageAt.desc()), index("agent_conversations_agent_idx").on(t.agentId)],
);

export const agentConversationMembers = pgTable(
  "agent_conversation_members",
  {
    id: pk(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => agentConversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("agent_conversation_members_unique").on(t.conversationId, t.userId), index("agent_conversation_members_user_idx").on(t.userId)],
);

export const agentMessages = pgTable(
  "agent_messages",
  {
    id: pk(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => agentConversations.id, { onDelete: "cascade" }),
    senderType: varchar("sender_type", { length: 8 }).$type<AgentSenderRowType>().notNull(),
    senderUserId: uuid("sender_user_id").references(() => users.id, { onDelete: "set null" }),
    content: text("content").notNull(),
    tokenCount: integer("token_count").notNull().default(0),
    moderationStatus: varchar("moderation_status", { length: 8 }).$type<ModerationRowStatus>().notNull().default("ok"),
    /** Idempotency key of user messages. */
    clientMessageId: uuid("client_message_id"),
    /** For agent messages: the user message being answered. */
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => agentMessages.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("agent_messages_conversation_idx").on(t.conversationId, t.createdAt.desc()),
    uniqueIndex("agent_messages_client_id_idx").on(t.conversationId, t.clientMessageId),
    index("agent_messages_reply_idx").on(t.replyToId),
    check("agent_messages_sender_check", oneOf(t.senderType, AGENT_SENDER_TYPES)),
    check("agent_messages_moderation_check", oneOf(t.moderationStatus, MODERATION_STATUSES)),
  ],
);

export const agentUserMemory = pgTable(
  "agent_user_memory",
  {
    id: pk(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => aiAgents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    memory: jsonb("memory").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("agent_user_memory_unique").on(t.agentId, t.userId)],
);

export const agentUsage = pgTable(
  "agent_usage",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => aiAgents.id, { onDelete: "cascade" }),
    productId: uuid("product_id").references(() => aiProducts.id, { onDelete: "set null" }),
    /** UTC day. */
    periodStart: date("period_start").notNull(),
    requests: integer("requests").notNull().default(0),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
  },
  (t) => [
    unique("agent_usage_period_unique").on(t.userId, t.agentId, t.productId, t.periodStart).nullsNotDistinct(),
    index("agent_usage_agent_period_idx").on(t.agentId, t.periodStart),
  ],
);

export const productReviews = pgTable(
  "product_reviews",
  {
    id: pk(),
    productId: uuid("product_id")
      .notNull()
      .references(() => aiProducts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: smallint("rating").notNull(),
    content: text("content").notNull().default(""),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("product_reviews_unique").on(t.productId, t.userId), check("product_reviews_rating_check", sql`${t.rating} between 1 and 5`)],
);

// -------------------------------------------------------------------------------------------------
// Coding Academy (SPEC-ADDENDUM-01 §5)
// -------------------------------------------------------------------------------------------------

export const learningTracks = pgTable(
  "learning_tracks",
  {
    id: pk(),
    slug: varchar("slug", { length: 60 }).notNull().unique(),
    title: varchar("title", { length: 120 }).notNull(),
    description: text("description").notNull().default(""),
    level: varchar("level", { length: 16 }).$type<TrackLevel>().notNull(),
    orderIndex: integer("order_index").notNull().default(0),
    isPublished: boolean("is_published").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("learning_tracks_level_check", oneOf(t.level, TRACK_LEVELS))],
);

export const lessons = pgTable(
  "lessons",
  {
    id: pk(),
    trackId: uuid("track_id")
      .notNull()
      .references(() => learningTracks.id, { onDelete: "cascade" }),
    slug: varchar("slug", { length: 60 }).notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    content: jsonb("content").$type<LessonContent>().notNull(),
    puzzleDefinition: jsonb("puzzle_definition").$type<PuzzleDefinition>().notNull(),
    xpReward: integer("xp_reward").notNull().default(0),
    orderIndex: integer("order_index").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("lessons_track_slug_idx").on(t.trackId, t.slug),
    index("lessons_track_order_idx").on(t.trackId, t.orderIndex),
    check("lessons_xp_reward_check", sql`${t.xpReward} >= 0`),
  ],
);

export const lessonProgress = pgTable(
  "lesson_progress",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lessonId: uuid("lesson_id")
      .notNull()
      .references(() => lessons.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 16 }).$type<LessonStatus>().notNull().default("not_started"),
    attempts: integer("attempts").notNull().default(0),
    bestActionCount: integer("best_action_count"),
    /** User-controlled draft (Blockly workspace JSON or source code). */
    lastCode: text("last_code"),
    lastEditorMode: varchar("last_editor_mode", { length: 8 }).$type<EditorMode>(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("lesson_progress_user_lesson_idx").on(t.userId, t.lessonId),
    index("lesson_progress_lesson_idx").on(t.lessonId, t.status),
    check("lesson_progress_status_check", oneOf(t.status, LESSON_STATUSES)),
    check("lesson_progress_editor_mode_check", sql`${t.lastEditorMode} is null or ${oneOf(t.lastEditorMode, EDITOR_MODE_VALUES)}`),
  ],
);

export const badges = pgTable("badges", {
  id: pk(),
  slug: varchar("slug", { length: 60 }).notNull().unique(),
  name: varchar("name", { length: 80 }).notNull(),
  description: text("description").notNull().default(""),
  iconUrl: text("icon_url"),
  criteria: jsonb("criteria").$type<BadgeCriteria>().notNull(),
  createdAt: createdAt(),
});

export const userBadges = pgTable(
  "user_badges",
  {
    id: pk(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    badgeId: uuid("badge_id")
      .notNull()
      .references(() => badges.id, { onDelete: "cascade" }),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("user_badges_unique").on(t.userId, t.badgeId)],
);

export const userLearningStats = pgTable(
  "user_learning_stats",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    totalXp: integer("total_xp").notNull().default(0),
    level: integer("level").notNull().default(1),
    currentStreak: integer("current_streak").notNull().default(0),
    longestStreak: integer("longest_streak").notNull().default(0),
    /** UTC day of the last successful attempt. */
    lastActivityDate: date("last_activity_date"),
    updatedAt: updatedAt(),
  },
  (t) => [index("user_learning_stats_xp_idx").on(t.totalXp.desc()), check("user_learning_stats_xp_check", sql`${t.totalXp} >= 0`)],
);
