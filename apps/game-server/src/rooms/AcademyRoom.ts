import { Room, ServerError, type AuthContext, type Client } from "@colyseus/core";
import { z, type ZodType } from "zod";
import { CloseReason } from "@entroworld/game-protocol";
import {
  SessionClientMessage,
  SessionServerMessage,
  sessionActionsSchema,
  sessionEditSchema,
  sessionEmptySchema,
  type AcademyTicketClaims,
  type SessionRunPayload,
} from "@entroworld/robot-api";
import { services } from "../services";
import { StrikeCounter, TokenBucket } from "../systems/RateLimiter";
import { AcademySession } from "../systems/academySession";
import { TicketError, presenceReplayGuard } from "../tickets";

type SessionClient = Client<{ userData: { limits: SessionLimits; strikes: StrikeCounter }; auth: AcademyTicketClaims }>;

export interface AcademyRoomMetadata {
  sessionId: string;
}

/** Seconds a dropped member's seat is held. */
export const ACADEMY_RECONNECT_SECONDS = 30;

function createLimits() {
  return {
    // The editor sends the whole workspace after each edit; bursts happen while dragging blocks.
    edit: new TokenBucket(20, 8),
    run: new TokenBucket(3, 1),
    submit: new TokenBucket(3, 1),
    other: new TokenBucket(5, 1),
  };
}
type SessionLimits = ReturnType<typeof createLimits>;

const createOptionsSchema = z.object({ sessionId: z.uuid() });

/**
 * One pair-programming session or coding battle between two friends (SPEC-ADDENDUM-01 §7). It
 * runs apart from the zone rooms, so editor traffic never touches the world's tick loop. The API
 * decides who belongs in a session; its tickets carry the session, the lesson and both members.
 */
export class AcademyRoom extends Room<{ metadata: AcademyRoomMetadata; client: SessionClient }> {
  /** Two members, plus room for a member's new tab replacing the old one. */
  override maxClients = 4;
  override maxMessagesPerSecond = 40;

  private sessionId!: string;
  private session: AcademySession | null = null;
  /** Loads the lesson once, for whichever member arrives first. */
  private loading: Promise<AcademySession> | null = null;

  private get svc() {
    return services();
  }

  private get log() {
    return this.svc.logger.child({ roomId: this.roomId, sessionId: this.sessionId });
  }

  override onCreate(options: unknown): void {
    const parsed = createOptionsSchema.safeParse(options);
    if (!parsed.success) throw new ServerError(400, "Unknown session");
    this.sessionId = parsed.data.sessionId;
    this.metadata = { sessionId: this.sessionId };
    this.registerMessages();
    this.log.info("academy session room created");
  }

  override async onAuth(_client: SessionClient, options: { ticket?: unknown }, _context: AuthContext): Promise<AcademyTicketClaims> {
    let claims: AcademyTicketClaims;
    try {
      claims = await this.svc.tickets.verifyAcademy(options?.ticket);
      const replay = this.svc.replay ?? presenceReplayGuard(this.presence);
      if (!(await replay.claim(claims.jti))) throw new TicketError("ticket_reused", "Session ticket was already used");
    } catch (e) {
      if (e instanceof TicketError) throw new ServerError(401, e.message);
      this.log.error("academy auth failed", { err: e });
      throw new ServerError(500, "Could not verify ticket");
    }
    if (claims.sessionId !== this.sessionId) throw new ServerError(403, "Ticket was issued for another session");
    if (!claims.members.includes(claims.sub)) throw new ServerError(403, "Not a member of this session");
    const session = await this.ensureSession(claims);
    if (session.kind !== claims.kind || session.lesson.id !== claims.lessonId || session.members.some((m) => !claims.members.includes(m.userId))) {
      throw new ServerError(409, "Session details changed");
    }
    return claims;
  }

  private ensureSession(claims: AcademyTicketClaims): Promise<AcademySession> {
    this.loading ??= this.svc.store.lessonPuzzle(claims.lessonId).then((lesson) => {
      if (!lesson) throw new ServerError(404, "Lesson not found");
      this.session = new AcademySession(this.sessionId, claims.kind, { id: lesson.lessonId, title: lesson.title, puzzle: lesson.puzzle }, [
        claims.members[0]!,
        claims.members[1]!,
      ]);
      return this.session;
    });
    // A failed load must not poison the room for the next attempt.
    this.loading.catch(() => {
      this.loading = null;
    });
    return this.loading;
  }

  override onJoin(client: SessionClient, _options: unknown, auth: AcademyTicketClaims): void {
    const claims = client.auth ?? auth;
    const session = this.session!;
    // One seat per person: a new tab replaces the old connection.
    for (const other of this.clients as unknown as SessionClient[]) {
      if (other !== client && other.auth?.sub === claims.sub) other.leave(CloseReason.DuplicateSession, "Joined from another window");
    }
    client.userData = { limits: createLimits(), strikes: new StrikeCounter() };
    session.connect(claims.sub, claims.displayName);
    this.broadcastState();
    if (session.program) client.send(SessionServerMessage.Program, session.program);
    this.log.info("member joined", { userId: claims.sub });
  }

  override onDrop(client: SessionClient): void {
    this.markAway(client);
    void this.allowReconnection(client, ACADEMY_RECONNECT_SECONDS).catch(() => undefined);
  }

  override onReconnect(client: SessionClient): void {
    if (!client.auth) return;
    this.session?.connect(client.auth.sub, client.auth.displayName);
    this.broadcastState();
    if (this.session?.program) client.send(SessionServerMessage.Program, this.session.program);
  }

  override onLeave(client: SessionClient): void {
    this.markAway(client);
  }

  private markAway(client: SessionClient): void {
    const userId = client.auth?.sub;
    if (!userId || !this.session) return;
    // Still here through another connection (the replaced tab leaves after the new one joined).
    const stillHere = (this.clients as unknown as SessionClient[]).some((c) => c !== client && c.auth?.sub === userId);
    if (stillHere) return;
    this.session.disconnect(userId);
    this.broadcastState();
  }

  override onDispose(): void {
    this.log.info("academy session room disposed");
  }

  override onUncaughtException(error: Error, methodName: string): void {
    this.log.error("uncaught academy room exception", { method: methodName, err: error });
  }

  // -----------------------------------------------------------------------------------------------
  // Messages
  // -----------------------------------------------------------------------------------------------

  private handle<T>(type: string, schema: ZodType<T>, bucket: keyof SessionLimits, handler: (client: SessionClient, userId: string, session: AcademySession, m: T) => void): void {
    this.onMessage(type, (client: SessionClient, raw: unknown) => {
      const session = this.session;
      if (!session || !client.userData || !client.auth) return;
      const parsed = schema.safeParse(raw ?? {});
      if (!parsed.success) return this.strike(client, "invalid_message", `Invalid "${type}" message`);
      if (!client.userData.limits[bucket].take()) return this.strike(client, "rate_limited", "Slow down a little.");
      handler(client, client.auth.sub, session, parsed.data);
    });
  }

  private registerMessages(): void {
    this.handle(SessionClientMessage.Sync, sessionEmptySchema, "other", (client, _userId, session) => {
      client.send(SessionServerMessage.State, session.view());
      if (session.program) client.send(SessionServerMessage.Program, session.program);
    });

    this.handle(SessionClientMessage.Edit, sessionEditSchema, "edit", (client, userId, session, m) => {
      const r = session.edit(userId, m.program);
      if (!r.ok) return this.sendError(client, r.code, r.message);
      for (const c of this.clients) if (c !== client) c.send(SessionServerMessage.Program, r.value);
    });

    this.handle(SessionClientMessage.Swap, sessionEmptySchema, "other", (client, userId, session) => {
      const r = session.swap(userId);
      if (!r.ok) return this.sendError(client, r.code, r.message);
      this.broadcastState();
    });

    this.handle(SessionClientMessage.Run, sessionActionsSchema, "run", (client, userId, session, m) => {
      const r = session.run(userId);
      if (!r.ok) return this.sendError(client, r.code, r.message);
      const payload: SessionRunPayload = { by: userId, actions: m.actions };
      for (const c of this.clients) if (c !== client) c.send(SessionServerMessage.Run, payload);
    });

    this.handle(SessionClientMessage.Ready, sessionEmptySchema, "other", (client, userId, session) => {
      const r = session.ready(userId);
      if (!r.ok) return this.sendError(client, r.code, r.message);
      this.broadcastState();
      if (r.value) {
        const startsAt = session.view().battle!.startsAt!;
        this.clock.setTimeout(() => {
          if (session.startRace()) this.broadcastState();
        }, Math.max(0, startsAt - Date.now()));
      }
    });

    this.handle(SessionClientMessage.Submit, sessionActionsSchema, "submit", (client, userId, session, m) => {
      const r = session.submit(userId, m.actions);
      if (!r.ok) return this.sendError(client, r.code, r.message);
      client.send(SessionServerMessage.Verdict, r.value);
      this.broadcastState();
      if (r.value.won) this.log.info("battle won", { userId, actionCount: r.value.actionCount });
    });

    this.handle(SessionClientMessage.Rematch, sessionEmptySchema, "other", (client, _userId, session) => {
      const r = session.rematch();
      if (!r.ok) return this.sendError(client, r.code, r.message);
      this.broadcastState();
    });

    this.onMessage("*", (client: SessionClient, type: unknown) => this.strike(client, "unknown_message", `Unknown message "${String(type).slice(0, 40)}"`));
  }

  private broadcastState(): void {
    if (this.session) this.broadcast(SessionServerMessage.State, this.session.view());
  }

  private sendError(client: SessionClient, code: string, message: string): void {
    client.send(SessionServerMessage.Error, { code, message });
  }

  private strike(client: SessionClient, code: string, message: string): void {
    if (client.userData?.strikes.add()) {
      this.log.warn("session member kicked for protocol abuse", { userId: client.auth?.sub });
      client.leave(CloseReason.Kicked, "Too many invalid requests");
      return;
    }
    this.sendError(client, code, message);
  }
}
