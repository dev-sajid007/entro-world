import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
export const REPORT_TARGETS = ["user", "post", "comment"] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];
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
