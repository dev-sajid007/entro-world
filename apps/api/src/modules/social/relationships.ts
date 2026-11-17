import { and, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { blocks, follows, friendships, profiles, users, type DbExecutor } from "@entroworld/database";
import type { FriendshipStatus, PublicUser } from "@entroworld/shared";
import { notFound } from "../../lib/errors";

// Social-graph helpers shared by every module: who may see whom, and what the relationship is.

/** SQL: `a` and `b` are accepted friends. */
export const friendsSql = (a: SQL | AnyPgColumn | string, b: SQL | AnyPgColumn | string): SQL =>
  sql`exists (select 1 from ${friendships} f where f.status = 'accepted' and ((f.requester_id = ${a} and f.addressee_id = ${b}) or (f.requester_id = ${b} and f.addressee_id = ${a})))`;

/** SQL: neither user has blocked the other. */
export const notBlockedSql = (a: SQL | AnyPgColumn | string, b: SQL | AnyPgColumn | string): SQL =>
  sql`not exists (select 1 from ${blocks} b where (b.blocker_id = ${a} and b.blocked_id = ${b}) or (b.blocker_id = ${b} and b.blocked_id = ${a}))`;

/** SQL: `follower` follows `followee`. */
export const followsSql = (follower: SQL | AnyPgColumn | string, followee: SQL | AnyPgColumn | string): SQL =>
  sql`exists (select 1 from ${follows} fo where fo.follower_id = ${follower} and fo.followee_id = ${followee})`;

/** Accounts that can be shown at all (not deleted, not banned). */
export const visibleAccount = and(isNull(users.deletedAt), ne(users.status, "banned"))!;

export const publicUserColumns = {
  id: users.id,
  username: users.username,
  displayName: users.displayName,
  avatarUrl: profiles.avatarUrl,
};

export async function loadPublicUsers(db: DbExecutor, ids: readonly string[]): Promise<Map<string, PublicUser>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db.select(publicUserColumns).from(users).leftJoin(profiles, eq(profiles.userId, users.id)).where(inArray(users.id, unique));
  return new Map(rows.map((r) => [r.id, { ...r, avatarUrl: r.avatarUrl ?? null }]));
}

export interface BlockState {
  /** The viewer blocked the target. */
  blocking: boolean;
  /** The target blocked the viewer. */
  blockedBy: boolean;
}

export async function blockState(db: DbExecutor, viewerId: string, targetId: string): Promise<BlockState> {
  if (viewerId === targetId) return { blocking: false, blockedBy: false };
  const rows = await db
    .select({ blockerId: blocks.blockerId })
    .from(blocks)
    .where(or(and(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, targetId)), and(eq(blocks.blockerId, targetId), eq(blocks.blockedId, viewerId))));
  return { blocking: rows.some((r) => r.blockerId === viewerId), blockedBy: rows.some((r) => r.blockerId === targetId) };
}

export interface FriendshipInfo {
  status: FriendshipStatus;
  requestId: string | null;
}

export async function friendshipInfo(db: DbExecutor, viewerId: string, targetId: string, blocksState?: BlockState): Promise<FriendshipInfo> {
  const b = blocksState ?? (await blockState(db, viewerId, targetId));
  if (b.blocking) return { status: "blocked", requestId: null };
  if (b.blockedBy) return { status: "blocked_by", requestId: null };
  const [row] = await db
    .select()
    .from(friendships)
    .where(
      or(
        and(eq(friendships.requesterId, viewerId), eq(friendships.addresseeId, targetId)),
        and(eq(friendships.requesterId, targetId), eq(friendships.addresseeId, viewerId)),
      ),
    )
    .limit(1);
  if (!row) return { status: "none", requestId: null };
  if (row.status === "accepted") return { status: "friends", requestId: null };
  return { status: row.requesterId === viewerId ? "pending_outgoing" : "pending_incoming", requestId: row.id };
}

/** Loads an active account the viewer may interact with, or throws 404 (blocked users don't exist to each other). */
export async function requireReachableUser(db: DbExecutor, viewerId: string, targetId: string) {
  const [target] = await db.select({ id: users.id, username: users.username }).from(users).where(and(eq(users.id, targetId), visibleAccount)).limit(1);
  if (!target) throw notFound("User");
  const b = await blockState(db, viewerId, targetId);
  if (b.blockedBy) throw notFound("User");
  return { target, blocks: b };
}
