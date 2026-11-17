import { and, asc, count, eq, isNull, ne, or, sql } from "drizzle-orm";
import {
  blocks,
  follows,
  friendships,
  getAvatar,
  isUniqueViolation,
  moderationReports,
  posts,
  profiles,
  saveAvatar,
  users,
  type ReportTarget,
} from "@entroworld/database";
import type { AvatarConfig, CurrentUser, FriendView, PublicUser, UserProfile } from "@entroworld/shared";
import type { ReportInput, UpdateMeInput } from "@entroworld/validation";
import type { AppContext } from "../../context";
import { badRequest, forbidden, notFound } from "../../lib/errors";
import { loadCurrentUser } from "../auth/service";
import { blockState, friendshipInfo, notBlockedSql, publicUserColumns, requireReachableUser, visibleAccount } from "../social/relationships";

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export class UsersService {
  constructor(private readonly ctx: AppContext) {}

  private get db() {
    return this.ctx.db;
  }

  async findIdByUsername(username: string): Promise<string> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(sql`lower(${users.username}) = ${username.toLowerCase()}`, visibleAccount))
      .limit(1);
    if (!row) throw notFound("User");
    return row.id;
  }

  /** Full profile as seen by `viewerId`; details are redacted when privacy settings don't allow them. */
  async profile(viewerId: string, targetId: string): Promise<UserProfile> {
    const [row] = await this.db
      .select({ ...publicUserColumns, createdAt: users.createdAt, bio: profiles.bio, coverUrl: profiles.coverUrl, privacy: profiles.privacy })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(and(eq(users.id, targetId), visibleAccount))
      .limit(1);
    if (!row) throw notFound("User");
    const isSelf = viewerId === targetId;
    const b = await blockState(this.db, viewerId, targetId);
    if (b.blockedBy) throw notFound("User");
    const friendship = isSelf ? { status: "none" as const, requestId: null } : await friendshipInfo(this.db, viewerId, targetId, b);
    const privacy = row.privacy ?? "public";
    const isFriend = friendship.status === "friends";
    const detailsVisible = isSelf || (!b.blocking && (privacy === "public" || (privacy === "friends" && isFriend)));

    const [following, followsYou] = isSelf ? [false, false] : await Promise.all([this.isFollowing(viewerId, targetId), this.isFollowing(targetId, viewerId)]);
    const zones = isSelf || isFriend ? await this.ctx.presence.zones([targetId]) : new Map();
    const zoneId = zones.get(targetId) ?? null;

    return {
      user: { id: row.id, username: row.username, displayName: row.displayName, avatarUrl: row.avatarUrl ?? null },
      bio: detailsVisible ? (row.bio ?? "") : "",
      coverUrl: detailsVisible ? (row.coverUrl ?? null) : null,
      privacy,
      avatar: await getAvatar(this.db, targetId, row.username),
      createdAt: row.createdAt.toISOString(),
      stats: detailsVisible ? await this.stats(targetId) : { friends: 0, followers: 0, following: 0, posts: 0 },
      relationship: { isSelf, friendship: friendship.status, friendRequestId: friendship.requestId, following, followsYou },
      online: zoneId !== null,
      location: zoneId ? { zoneId } : null,
      restricted: !detailsVisible,
    };
  }

  async updateMe(userId: string, input: UpdateMeInput): Promise<CurrentUser> {
    await this.db.transaction(async (tx) => {
      if (input.displayName !== undefined) await tx.update(users).set({ displayName: input.displayName }).where(eq(users.id, userId));
      const profileChanges: Partial<typeof profiles.$inferInsert> = {};
      if (input.bio !== undefined) profileChanges.bio = input.bio;
      if (input.privacy !== undefined) profileChanges.privacy = input.privacy;
      if (Object.keys(profileChanges).length > 0) {
        await tx
          .insert(profiles)
          .values({ userId, ...profileChanges })
          .onConflictDoUpdate({ target: profiles.userId, set: profileChanges });
      }
    });
    const user = await loadCurrentUser(this.db, userId);
    if (!user) throw notFound("User");
    return user;
  }

  async avatar(userId: string): Promise<AvatarConfig> {
    const [row] = await this.db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
    if (!row) throw notFound("User");
    return getAvatar(this.db, userId, row.username);
  }

  async setAvatar(userId: string, avatar: AvatarConfig): Promise<AvatarConfig> {
    await saveAvatar(this.db, userId, avatar);
    return avatar;
  }

  /** Username prefix or display-name substring match, hiding blocked accounts in both directions. */
  async search(viewerId: string, q: string, limit: number): Promise<PublicUser[]> {
    const needle = likeEscape(q.toLowerCase().replace(/^@/, ""));
    if (!needle) return [];
    const rows = await this.db
      .select(publicUserColumns)
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(
        and(
          visibleAccount,
          ne(users.id, viewerId),
          or(sql`lower(${users.username}) like ${needle + "%"}`, sql`lower(${users.displayName}) like ${"%" + needle + "%"}`),
          notBlockedSql(viewerId, users.id),
        ),
      )
      .orderBy(sql`lower(${users.username}) like ${needle + "%"} desc`, asc(users.username))
      .limit(limit);
    return rows.map((r) => ({ ...r, avatarUrl: r.avatarUrl ?? null }));
  }

  /** A user's friends, if their privacy settings let the viewer see them. */
  async friendsOf(viewerId: string, targetId: string): Promise<FriendView[]> {
    const profile = await this.profile(viewerId, targetId);
    if (profile.restricted) throw forbidden("This friend list is private", "private_profile");
    const rows = await this.db
      .select({ ...publicUserColumns, since: friendships.updatedAt })
      .from(friendships)
      .innerJoin(users, sql`${users.id} = case when ${friendships.requesterId} = ${targetId} then ${friendships.addresseeId} else ${friendships.requesterId} end`)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(
        and(
          eq(friendships.status, "accepted"),
          or(eq(friendships.requesterId, targetId), eq(friendships.addresseeId, targetId)),
          visibleAccount,
          notBlockedSql(viewerId, users.id),
        ),
      )
      .orderBy(asc(users.displayName));
    // Only the owner of the list learns where their friends are.
    const zones = viewerId === targetId ? await this.ctx.presence.zones(rows.map((r) => r.id)) : new Map();
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.displayName,
      avatarUrl: r.avatarUrl ?? null,
      online: zones.has(r.id),
      zoneId: zones.get(r.id) ?? null,
      since: r.since.toISOString(),
    }));
  }

  /** Blocking also ends any friendship or pending request and removes follows in both directions. */
  async block(viewerId: string, targetId: string): Promise<void> {
    if (viewerId === targetId) throw badRequest("You can't block yourself");
    const [target] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.id, targetId), isNull(users.deletedAt))).limit(1);
    if (!target) throw notFound("User");
    await this.db.transaction(async (tx) => {
      await tx.insert(blocks).values({ blockerId: viewerId, blockedId: targetId }).onConflictDoNothing();
      await tx
        .delete(friendships)
        .where(
          or(
            and(eq(friendships.requesterId, viewerId), eq(friendships.addresseeId, targetId)),
            and(eq(friendships.requesterId, targetId), eq(friendships.addresseeId, viewerId)),
          ),
        );
      await tx
        .delete(follows)
        .where(or(and(eq(follows.followerId, viewerId), eq(follows.followeeId, targetId)), and(eq(follows.followerId, targetId), eq(follows.followeeId, viewerId))));
    });
  }

  async unblock(viewerId: string, targetId: string): Promise<void> {
    await this.db.delete(blocks).where(and(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, targetId)));
  }

  async blocked(viewerId: string): Promise<PublicUser[]> {
    const rows = await this.db
      .select(publicUserColumns)
      .from(blocks)
      .innerJoin(users, eq(users.id, blocks.blockedId))
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(blocks.blockerId, viewerId))
      .orderBy(asc(users.username));
    return rows.map((r) => ({ ...r, avatarUrl: r.avatarUrl ?? null }));
  }

  async follow(viewerId: string, targetId: string): Promise<void> {
    if (viewerId === targetId) throw badRequest("You can't follow yourself");
    const { blocks: b } = await requireReachableUser(this.db, viewerId, targetId);
    if (b.blocking) throw forbidden("Unblock this person first", "blocked");
    await this.db.insert(follows).values({ followerId: viewerId, followeeId: targetId }).onConflictDoNothing();
  }

  async unfollow(viewerId: string, targetId: string): Promise<void> {
    await this.db.delete(follows).where(and(eq(follows.followerId, viewerId), eq(follows.followeeId, targetId)));
  }

  /** Files a moderation report; repeating an open report is a no-op. */
  async report(reporterId: string, target: { type: ReportTarget; userId: string | null; contentId: string | null }, input: ReportInput): Promise<void> {
    try {
      await this.db.insert(moderationReports).values({
        reporterId,
        targetType: target.type,
        targetUserId: target.userId,
        targetContentId: target.contentId,
        reason: input.reason,
        details: input.details,
      });
    } catch (e) {
      if (!isUniqueViolation(e, "moderation_reports_dedupe")) throw e;
    }
  }

  private async isFollowing(followerId: string, followeeId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ one: sql`1` })
      .from(follows)
      .where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)))
      .limit(1);
    return !!row;
  }

  private async stats(userId: string): Promise<UserProfile["stats"]> {
    const [friendsRow] = await this.db
      .select({ n: count() })
      .from(friendships)
      .where(and(eq(friendships.status, "accepted"), or(eq(friendships.requesterId, userId), eq(friendships.addresseeId, userId))));
    const [followersRow] = await this.db.select({ n: count() }).from(follows).where(eq(follows.followeeId, userId));
    const [followingRow] = await this.db.select({ n: count() }).from(follows).where(eq(follows.followerId, userId));
    const [postsRow] = await this.db.select({ n: count() }).from(posts).where(and(eq(posts.userId, userId), isNull(posts.deletedAt)));
    return { friends: friendsRow?.n ?? 0, followers: followersRow?.n ?? 0, following: followingRow?.n ?? 0, posts: postsRow?.n ?? 0 };
  }
}
