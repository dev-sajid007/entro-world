import { and, desc, eq, or } from "drizzle-orm";
import { friendships, isUniqueViolation, profiles, users } from "@entroworld/database";
import type { FriendRequestView } from "@entroworld/shared";
import type { AppContext } from "../../context";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors";
import { friendshipInfo, loadPublicUsers, requireReachableUser, visibleAccount } from "../social/relationships";

const MAX_PENDING_OUTGOING = 100;

export class FriendsService {
  constructor(private readonly ctx: AppContext) {}

  private get db() {
    return this.ctx.db;
  }

  /**
   * Sends a request, or accepts the other person's pending request if one exists (both
   * people asking means both want it).
   */
  async request(viewerId: string, targetId: string): Promise<{ status: "pending_outgoing" | "friends"; requestId: string | null }> {
    if (viewerId === targetId) throw badRequest("You can't add yourself as a friend");
    const { blocks: b } = await requireReachableUser(this.db, viewerId, targetId);
    if (b.blocking) throw forbidden("Unblock this person first", "blocked");

    const existing = await friendshipInfo(this.db, viewerId, targetId, b);
    if (existing.status === "friends") throw conflict("You're already friends", "already_friends");
    if (existing.status === "pending_outgoing") return { status: "pending_outgoing", requestId: existing.requestId };
    if (existing.status === "pending_incoming" && existing.requestId) {
      await this.accept(viewerId, existing.requestId);
      return { status: "friends", requestId: null };
    }

    const pending = await this.db
      .select({ id: friendships.id })
      .from(friendships)
      .where(and(eq(friendships.requesterId, viewerId), eq(friendships.status, "pending")))
      .limit(MAX_PENDING_OUTGOING);
    if (pending.length >= MAX_PENDING_OUTGOING) throw conflict("You have too many pending friend requests", "too_many_pending");

    try {
      const [row] = await this.db.insert(friendships).values({ requesterId: viewerId, addresseeId: targetId }).returning({ id: friendships.id });
      return { status: "pending_outgoing", requestId: row!.id };
    } catch (e) {
      // The other person sent one at the same moment.
      if (isUniqueViolation(e, "friendships_pair_unique")) {
        const again = await friendshipInfo(this.db, viewerId, targetId);
        if (again.status === "pending_incoming" && again.requestId) {
          await this.accept(viewerId, again.requestId);
          return { status: "friends", requestId: null };
        }
        return { status: "pending_outgoing", requestId: again.requestId };
      }
      throw e;
    }
  }

  async accept(viewerId: string, requestId: string): Promise<void> {
    const [row] = await this.db
      .update(friendships)
      .set({ status: "accepted" })
      .where(and(eq(friendships.id, requestId), eq(friendships.addresseeId, viewerId), eq(friendships.status, "pending")))
      .returning({ id: friendships.id });
    if (!row) throw notFound("Friend request");
  }

  /** Declines an incoming request or cancels an outgoing one. */
  async decline(viewerId: string, requestId: string): Promise<void> {
    const rows = await this.db
      .delete(friendships)
      .where(
        and(eq(friendships.id, requestId), eq(friendships.status, "pending"), or(eq(friendships.addresseeId, viewerId), eq(friendships.requesterId, viewerId))),
      )
      .returning({ id: friendships.id });
    if (rows.length === 0) throw notFound("Friend request");
  }

  async remove(viewerId: string, friendId: string): Promise<void> {
    const rows = await this.db
      .delete(friendships)
      .where(
        and(
          eq(friendships.status, "accepted"),
          or(
            and(eq(friendships.requesterId, viewerId), eq(friendships.addresseeId, friendId)),
            and(eq(friendships.requesterId, friendId), eq(friendships.addresseeId, viewerId)),
          ),
        ),
      )
      .returning({ id: friendships.id });
    if (rows.length === 0) throw notFound("Friend");
  }

  async requests(viewerId: string, direction: "incoming" | "outgoing"): Promise<FriendRequestView[]> {
    const mine = direction === "incoming" ? friendships.addresseeId : friendships.requesterId;
    const other = direction === "incoming" ? friendships.requesterId : friendships.addresseeId;
    const rows = await this.db
      .select({ id: friendships.id, requesterId: friendships.requesterId, addresseeId: friendships.addresseeId, createdAt: friendships.createdAt })
      .from(friendships)
      .innerJoin(users, eq(users.id, other))
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(and(eq(mine, viewerId), eq(friendships.status, "pending"), visibleAccount))
      .orderBy(desc(friendships.createdAt));
    const people = await loadPublicUsers(this.db, rows.flatMap((r) => [r.requesterId, r.addresseeId]));
    return rows.flatMap((r) => {
      const from = people.get(r.requesterId);
      const to = people.get(r.addresseeId);
      return from && to ? [{ id: r.id, from, to, createdAt: r.createdAt.toISOString() }] : [];
    });
  }
}
