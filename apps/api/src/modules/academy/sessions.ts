import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { learningTracks, lessons } from "@entroworld/database";
import {
  INVITE_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  type AcademySessionView,
  type CreateSessionRequest,
  type SessionJoinResponse,
  type SessionKind,
} from "@entroworld/robot-api";
import type { AppContext } from "../../context";
import { badRequest, conflict, forbidden, notFound, tooManyRequests } from "../../lib/errors";
import { friendshipInfo, loadPublicUsers, requireReachableUser } from "../social/relationships";

interface StoredSession {
  id: string;
  kind: SessionKind;
  lessonId: string;
  lessonTitle: string;
  hostId: string;
  guestId: string;
  createdAt: string;
}

const sessionKey = (id: string) => `ew:academy:session:${id}`;
/** Sorted set of session ids a user was invited to, scored by invitation time (ms). */
const invitesKey = (userId: string) => `ew:academy:invites:${userId}`;
const createLimitKey = (userId: string) => `ew:academy:session-create:${userId}`;
/** Invitations a user may send per 10 minutes. */
const CREATES_PER_WINDOW = 10;

/**
 * Pair-programming sessions and coding battles between two friends (SPEC-ADDENDUM-01 §6, A3).
 * The API decides who may be in a session and issues room tickets; the session itself runs in
 * an `academy` room on the game server. State lives in Redis with a TTL, so nothing lingers.
 */
export class AcademySessionService {
  constructor(private readonly ctx: AppContext) {}

  private get redis() {
    return this.ctx.redis;
  }

  private async load(id: string): Promise<StoredSession | null> {
    const raw = await this.redis.get(sessionKey(id));
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  }

  private async view(s: StoredSession): Promise<AcademySessionView> {
    const people = await loadPublicUsers(this.ctx.db, [s.hostId, s.guestId]);
    const party = (id: string) => {
      const u = people.get(id);
      return { id, username: u?.username ?? "", displayName: u?.displayName ?? "Someone" };
    };
    return { id: s.id, kind: s.kind, lesson: { id: s.lessonId, title: s.lessonTitle }, host: party(s.hostId), guest: party(s.guestId), createdAt: s.createdAt };
  }

  private async ticket(s: StoredSession, userId: string): Promise<SessionJoinResponse> {
    const view = await this.view(s);
    const me = userId === s.hostId ? view.host : view.guest;
    const { ticket } = await this.ctx.gameTickets.signAcademy({
      sub: userId,
      username: me.username,
      displayName: me.displayName,
      sessionId: s.id,
      kind: s.kind,
      lessonId: s.lessonId,
      members: [s.hostId, s.guestId],
    });
    return { session: view, ticket, gameServerUrl: this.ctx.env.GAME_SERVER_PUBLIC_URL };
  }

  /** Starts a session and invites a friend, who is told through their game session. */
  async create(hostId: string, input: CreateSessionRequest): Promise<SessionJoinResponse> {
    if (input.friendId === hostId) throw badRequest("Invite a friend, not yourself.", "invalid_friend");
    const { blocks } = await requireReachableUser(this.ctx.db, hostId, input.friendId);
    if ((await friendshipInfo(this.ctx.db, hostId, input.friendId, blocks)).status !== "friends") {
      throw forbidden("You can only invite friends.", "not_friends");
    }
    const [lesson] = await this.ctx.db
      .select({ id: lessons.id, title: lessons.title })
      .from(lessons)
      .innerJoin(learningTracks, eq(learningTracks.id, lessons.trackId))
      .where(and(eq(lessons.id, input.lessonId), eq(learningTracks.isPublished, true)));
    if (!lesson) throw notFound("Lesson");

    const count = await this.redis.incr(createLimitKey(hostId));
    if (count === 1) await this.redis.expire(createLimitKey(hostId), 600);
    if (count > CREATES_PER_WINDOW) throw tooManyRequests("You've sent a lot of invitations. Try again in a few minutes.");

    const session: StoredSession = {
      id: randomUUID(),
      kind: input.kind,
      lessonId: lesson.id,
      lessonTitle: lesson.title,
      hostId,
      guestId: input.friendId,
      createdAt: new Date().toISOString(),
    };
    await this.redis.set(sessionKey(session.id), JSON.stringify(session), "EX", SESSION_TTL_SECONDS);
    await this.redis.zadd(invitesKey(session.guestId), Date.now(), session.id);
    await this.redis.expire(invitesKey(session.guestId), SESSION_TTL_SECONDS);

    const result = await this.ticket(session, hostId);
    await this.ctx.presence.control({
      type: "academy_invite",
      userId: session.guestId,
      invite: { sessionId: session.id, kind: session.kind, lessonTitle: session.lessonTitle, from: { id: hostId, displayName: result.session.host.displayName } },
    });
    return result;
  }

  /** A fresh room ticket for a member of the session (accepting an invitation, or reconnecting). */
  async join(userId: string, sessionId: string): Promise<SessionJoinResponse> {
    const s = await this.load(sessionId);
    if (!s || (s.hostId !== userId && s.guestId !== userId)) throw notFound("Session");
    // Someone who blocked the other since the invitation can't be pulled back in.
    await requireReachableUser(this.ctx.db, userId, userId === s.hostId ? s.guestId : s.hostId).catch(() => {
      throw conflict("This session is no longer available.", "session_closed");
    });
    if (userId === s.guestId) await this.redis.zrem(invitesKey(userId), s.id);
    return this.ticket(s, userId);
  }

  /** Open invitations to the user, newest first. */
  async invites(userId: string): Promise<AcademySessionView[]> {
    const key = invitesKey(userId);
    await this.redis.zremrangebyscore(key, 0, Date.now() - INVITE_TTL_SECONDS * 1000);
    const ids = await this.redis.zrevrange(key, 0, 19);
    const sessions: StoredSession[] = [];
    for (const id of ids) {
      const s = await this.load(id);
      if (s && s.guestId === userId) sessions.push(s);
      else await this.redis.zrem(key, id);
    }
    return Promise.all(sessions.map((s) => this.view(s)));
  }

  /** Declines an invitation (guest) or calls the session off (host). */
  async leave(userId: string, sessionId: string): Promise<void> {
    const s = await this.load(sessionId);
    if (!s || (s.hostId !== userId && s.guestId !== userId)) throw notFound("Session");
    await this.redis.zrem(invitesKey(s.guestId), s.id);
    if (userId === s.hostId) await this.redis.del(sessionKey(s.id));
  }
}
