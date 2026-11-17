import { randomUUID } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { livekitConfigured } from "@entroworld/config";
import type { CallEndReason, CallEvent, CallJoinResponse, CallParty, CallView } from "@entroworld/game-protocol";
import type { AppContext } from "../../context";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../lib/errors";
import { friendshipInfo, loadPublicUsers, requireReachableUser } from "../social/relationships";

/** Ringing calls expire on their own a little after the client-side ring timeout. */
const RING_TTL_SECONDS = 40;
/** Upper bound for an active call's state (tokens are shorter-lived; see TOKEN_TTL). */
const ACTIVE_TTL_SECONDS = 4 * 60 * 60;
const TOKEN_TTL = "2h";

const callKey = (id: string) => `ew:call:${id}`;
const userCallKey = (userId: string) => `ew:user-call:${userId}`;

interface StoredCall {
  id: string;
  callerId: string;
  calleeId: string;
  status: "ringing" | "active";
  createdAt: string;
}

const voiceUnavailable = () => new AppError(503, "voice_unavailable", "Voice calls are not available right now.");

/**
 * 1:1 voice calls between friends. State lives in Redis (short TTLs, so crashed clients never
 * leave a call stuck); events reach the other person through their game session.
 */
export class CallService {
  constructor(private readonly ctx: AppContext) {}

  private get redis() {
    return this.ctx.redis;
  }

  private livekit() {
    const env = this.ctx.env;
    if (!livekitConfigured(env) || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET || !env.LIVEKIT_URL) throw voiceUnavailable();
    return { url: env.LIVEKIT_PUBLIC_URL ?? env.LIVEKIT_URL, key: env.LIVEKIT_API_KEY, secret: env.LIVEKIT_API_SECRET };
  }

  private async load(id: string): Promise<StoredCall | null> {
    const raw = await this.redis.get(callKey(id));
    return raw ? (JSON.parse(raw) as StoredCall) : null;
  }

  private async view(call: StoredCall): Promise<CallView> {
    const users = await loadPublicUsers(this.ctx.db, [call.callerId, call.calleeId]);
    const party = (id: string): CallParty => {
      const u = users.get(id);
      return { id, username: u?.username ?? "", displayName: u?.displayName ?? "Someone", avatarUrl: u?.avatarUrl ?? null };
    };
    return { id: call.id, caller: party(call.callerId), callee: party(call.calleeId), status: call.status, createdAt: call.createdAt };
  }

  private notify(userId: string, event: CallEvent): Promise<void> {
    return this.ctx.presence.control({ type: "call", userId, event });
  }

  private async token(call: StoredCall, userId: string): Promise<CallJoinResponse["voice"]> {
    const lk = this.livekit();
    const room = `ew-call-${call.id}`;
    const users = await loadPublicUsers(this.ctx.db, [userId]);
    const at = new AccessToken(lk.key, lk.secret, { identity: userId, name: users.get(userId)?.displayName ?? "", ttl: TOKEN_TTL });
    at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: false });
    return { url: lk.url, token: await at.toJwt(), room };
  }

  /** Starts ringing a friend who is in the world. */
  async start(callerId: string, calleeId: string): Promise<CallView> {
    this.livekit();
    if (callerId === calleeId) throw badRequest("You can't call yourself.", "invalid_callee");
    const { blocks } = await requireReachableUser(this.ctx.db, callerId, calleeId);
    if ((await friendshipInfo(this.ctx.db, callerId, calleeId, blocks)).status !== "friends") throw forbidden("You can only call friends.", "not_friends");
    const online = await this.ctx.presence.zones([callerId, calleeId]);
    if (!online.has(callerId)) throw conflict("Enter the city to make calls.", "not_in_world");
    if (!online.has(calleeId)) throw conflict("Your friend isn't in the city right now.", "callee_offline");

    const call: StoredCall = { id: randomUUID(), callerId, calleeId, status: "ringing", createdAt: new Date().toISOString() };
    if ((await this.redis.set(userCallKey(callerId), call.id, "EX", RING_TTL_SECONDS, "NX")) !== "OK") {
      throw conflict("You're already in a call.", "already_in_call");
    }
    if ((await this.redis.set(userCallKey(calleeId), call.id, "EX", RING_TTL_SECONDS, "NX")) !== "OK") {
      await this.redis.del(userCallKey(callerId));
      throw conflict("Your friend is in another call.", "callee_busy");
    }
    await this.redis.set(callKey(call.id), JSON.stringify(call), "EX", RING_TTL_SECONDS);
    const view = await this.view(call);
    await this.notify(calleeId, { kind: "incoming", call: view });
    return view;
  }

  private async participantCall(userId: string, callId: string): Promise<StoredCall> {
    const call = await this.load(callId);
    if (!call || (call.callerId !== userId && call.calleeId !== userId)) throw notFound("Call");
    return call;
  }

  /** The callee picks up; both sides then join the call's voice room. */
  async accept(userId: string, callId: string): Promise<CallJoinResponse> {
    const call = await this.participantCall(userId, callId);
    if (call.calleeId !== userId) throw forbidden("Only the person being called can answer.", "not_callee");
    if (call.status !== "ringing") throw conflict("This call was already answered.", "call_active");
    const active: StoredCall = { ...call, status: "active" };
    // XX: fails if the caller cancelled (or the ring expired) in the meantime.
    if ((await this.redis.set(callKey(call.id), JSON.stringify(active), "EX", ACTIVE_TTL_SECONDS, "XX")) !== "OK") throw notFound("Call");
    await this.redis.expire(userCallKey(call.callerId), ACTIVE_TTL_SECONDS);
    await this.redis.expire(userCallKey(call.calleeId), ACTIVE_TTL_SECONDS);
    await this.notify(call.callerId, { kind: "accepted", callId: call.id });
    return { call: await this.view(active), voice: await this.token(active, userId) };
  }

  /** A voice token for an answered call (the caller fetches it after the `accepted` event). */
  async join(userId: string, callId: string): Promise<CallJoinResponse> {
    const call = await this.participantCall(userId, callId);
    if (call.status !== "active") throw conflict("The call hasn't been answered yet.", "call_ringing");
    return { call: await this.view(call), voice: await this.token(call, userId) };
  }

  /**
   * Ends a call from either side: hanging up, cancelling an unanswered call, declining, or (caller
   * only) giving up after the ring timeout (`missed`). The other side is told why.
   */
  async end(userId: string, callId: string, timedOut = false): Promise<void> {
    const call = await this.participantCall(userId, callId);
    // Only the first end wins; later ones (both sides hanging up at once) are no-ops.
    if ((await this.redis.del(callKey(call.id))) === 0) return;
    for (const id of [call.callerId, call.calleeId]) {
      // Compare-and-delete: never release a newer call of the same user.
      await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", 1, userCallKey(id), call.id);
    }
    const isCaller = call.callerId === userId;
    let reason: CallEndReason = "hangup";
    if (call.status === "ringing") reason = isCaller ? (timedOut ? "missed" : "cancelled") : "declined";
    await this.notify(isCaller ? call.calleeId : call.callerId, { kind: "ended", callId: call.id, reason });
  }

  /** The user's current call, if any (lets a reloaded page recover). */
  async current(userId: string): Promise<CallView | null> {
    const id = await this.redis.get(userCallKey(userId));
    const call = id ? await this.load(id) : null;
    return call ? this.view(call) : null;
  }
}
