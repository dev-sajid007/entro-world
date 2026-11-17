import { randomUUID } from "node:crypto";
import { Room, ServerError, type AuthContext, type Client, type Deferred } from "@colyseus/core";
import { StateView } from "@colyseus/schema";
import { z, type ZodType } from "zod";
import { EMOTE_DURATION_MS, generateAvatar } from "@entroworld/avatar";
import {
  AnimCode,
  ClientMessage,
  CloseReason,
  NPC_CONTROL_CHANNEL,
  ONLINE_TTL_SECONDS,
  ServerMessage,
  USER_CONTROL_CHANNEL,
  chatMessageSchema,
  emoteMessageSchema,
  inputMessageSchema,
  interactMessageSchema,
  onlineKey,
  pingSchema,
  travelMessageSchema,
  userControlSchema,
  voiceStateSchema,
  type ChatBroadcast,
  type ErrorPayload,
  type GameTicketClaims,
  type WelcomePayload,
  type ZoneTransferPayload,
} from "@entroworld/game-protocol";
import { NETWORK, distance2D, isZoneId, rectContains, type Rect, type ZoneId } from "@entroworld/shared";
import { getCityLayout, getInteractive, getZoneLayout, interactivesInZone, resolveZone, type InteractiveObject } from "@entroworld/world-assets";
import { PlayerSimulation } from "../movement/PlayerSimulation";
import { ObjectState, PlayerState, ZoneState } from "../schemas/ZoneState";
import { services } from "../services";
import { InterestManager } from "../systems/InterestManager";
import { StrikeCounter, createActionLimits, type ActionLimits, type TokenBucket } from "../systems/RateLimiter";
import { ChatHistory, chatTopics, isChatBroadcast, sanitizeChatText } from "../systems/chat";
import { Shopkeepers } from "../systems/shopkeepers";
import { computeVoicePeers } from "../systems/voice";
import { TicketError, presenceReplayGuard } from "../tickets";

export const ZONE_ROOM_RECONNECT_SECONDS = 20;
/** A client told to switch zones must leave within this time. */
export const TRANSFER_TIMEOUT_MS = 15_000;
/** Extra distance (m) tolerated beyond an object's interaction radius (latency between client and server). */
const INTERACT_TOLERANCE = 1.5;
const INTEREST_EVERY_TICKS = 4;
const VOICE_EVERY_TICKS = 10;
/** Room instance player counts are written at most every 5 s. */
const INSTANCE_EVERY_TICKS = 5 * NETWORK.serverTickRate;
/** Online presence keys are refreshed well within their TTL. */
const PRESENCE_EVERY_TICKS = (ONLINE_TTL_SECONDS / 3) * NETWORK.serverTickRate;
/** Positions are saved every 30 s (and when a player leaves), so a crash loses little. */
export const SAVE_EVERY_TICKS = 30 * NETWORK.serverTickRate;
/** Shopkeeper animation, facing and counter detection run at about 10 Hz. */
const NPC_EVERY_TICKS = Math.max(1, Math.round(NETWORK.serverTickRate / 10));
/** Shops opening or closing show up within a minute. */
const NPC_REFRESH_TICKS = 60 * NETWORK.serverTickRate;

type ZoneClient = Client<{ userData: Record<string, never>; auth: GameTicketClaims }>;

export interface ZoneRoomMetadata {
  zoneId: ZoneId;
}

interface Session {
  /** Null while the connection dropped and the seat is held for reconnection. */
  client: ZoneClient | null;
  claims: GameTicketClaims;
  player: PlayerState;
  sim: PlayerSimulation;
  limits: ActionLimits;
  strikes: StrikeCounter;
  emoteUntil: number;
  transfer: { zoneId: ZoneId; deadline: number } | null;
  reconnection: Deferred<Client> | null;
  voiceEnabled: boolean;
  lastVoicePeers: string;
  /** Last position written to the store, to skip unchanged saves. */
  savedKey: string;
}

/** Why a session ends; decides what is persisted and whether the player still counts as online. */
type EndReason = "left" | "transfer" | "replaced" | "dispose";

/**
 * One multiplayer instance of a city zone. The room is authoritative: clients send input frames,
 * the server simulates movement with the same physics code the client predicts with, and
 * synchronizes the result. Several rooms may exist per zone (matchmaking filters by `zoneId`).
 */
export class ZoneRoom extends Room<{ state: ZoneState; metadata: ZoneRoomMetadata; client: ZoneClient }> {
  override maxClients = NETWORK.defaultRoomCapacity;
  override patchRate = NETWORK.patchRateMs;
  /** Inputs arrive ~30/s; anything far beyond that is abuse and closes the connection. */
  override maxMessagesPerSecond = 90;
  override state = new ZoneState();

  private zoneId!: ZoneId;
  /** Movement validation bounds: the whole map (players may stand in a border margin before transferring). */
  private readonly bounds: Rect = getCityLayout().bounds;
  private readonly sessions = new Map<string, Session>();
  private readonly interest = new InterestManager<PlayerState>();
  private readonly history = new ChatHistory();
  private readonly onChatPublished = (message: unknown) => {
    if (isChatBroadcast(message)) this.deliverChat(message);
  };
  private tickCount = 0;
  private readonly fountainCooldown = new Map<string, number>();
  private instanceDirty = false;
  private readonly onUserControl = (raw: unknown) => this.handleUserControl(raw);
  private shopkeepers!: Shopkeepers;
  private readonly onNpcControl = (raw: unknown) => this.shopkeepers.control(raw);

  private get svc() {
    return services();
  }

  private get log() {
    return this.svc.logger.child({ roomId: this.roomId, zoneId: this.zoneId });
  }

  // -----------------------------------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------------------------------

  override async onCreate(options: { zoneId?: unknown }): Promise<void> {
    if (!isZoneId(options?.zoneId)) throw new ServerError(400, "Unknown zone");
    this.zoneId = options.zoneId;
    this.metadata = { zoneId: this.zoneId };
    this.state.zoneId = this.zoneId;

    for (const o of interactivesInZone(this.zoneId)) {
      if (o.kind !== "seat" && o.kind !== "fountain") continue;
      const obj = new ObjectState();
      obj.id = o.id;
      obj.kind = o.kind;
      obj.occupant = "";
      obj.active = true;
      obj.value = "";
      this.state.objects.set(o.id, obj);
    }

    this.shopkeepers = new Shopkeepers(this.zoneId);
    if (this.shopkeepers.shops.length > 0) {
      await this.refreshShopkeepers();
      await this.presence.subscribe(NPC_CONTROL_CHANNEL, this.onNpcControl);
    }

    this.registerMessages();
    await this.presence.subscribe(chatTopics.zone(this.zoneId), this.onChatPublished);
    await this.presence.subscribe(chatTopics.global, this.onChatPublished);
    await this.presence.subscribe(USER_CONTROL_CHANNEL, this.onUserControl);
    this.writeInstance("open");

    this.setTimestep((deltaMs) => this.tick(deltaMs), 1000 / NETWORK.serverTickRate);
    this.svc.metrics.registerRoom(this.roomId, this.zoneId, () => this.clients.length);
    this.log.info("room created");
  }

  override async onAuth(_client: ZoneClient, options: { ticket?: unknown; zoneId?: unknown }, _context: AuthContext): Promise<GameTicketClaims> {
    try {
      const claims = await this.svc.tickets.verify(options?.ticket);
      if (claims.zoneId !== this.zoneId) throw new ServerError(403, "Ticket was issued for another zone");
      const replay = this.svc.replay ?? presenceReplayGuard(this.presence);
      if (!(await replay.claim(claims.jti))) throw new TicketError("ticket_reused", "Room ticket was already used");
      return claims;
    } catch (e) {
      this.svc.metrics.rejectedJoins++;
      if (e instanceof ServerError) throw e;
      if (e instanceof TicketError) throw new ServerError(401, e.message);
      this.log.error("auth failed", { err: e });
      throw new ServerError(500, "Could not verify ticket");
    }
  }

  override async onJoin(client: ZoneClient, _options: unknown, auth: GameTicketClaims): Promise<void> {
    const claims = client.auth ?? auth;
    this.replaceDuplicateSessions(claims.sub);

    const spawn = this.safeSpawn(claims.spawn);
    const sim = PlayerSimulation.spawn(this.svc.physics, spawn.x, spawn.y, spawn.z, spawn.rotation);
    const player = new PlayerState();
    player.userId = claims.sub;
    player.username = claims.username;
    player.displayName = claims.displayName;
    player.emote = "";
    player.seatId = "";
    player.voice = false;
    player.speaking = false;
    player.avatar = JSON.stringify(await this.loadAvatar(claims));

    const session: Session = {
      client,
      claims,
      player,
      sim,
      limits: createActionLimits(),
      strikes: new StrikeCounter(),
      emoteUntil: 0,
      transfer: null,
      reconnection: null,
      voiceEnabled: false,
      lastVoicePeers: "",
      savedKey: "",
    };
    this.syncPlayer(session);
    this.sessions.set(client.sessionId, session);
    this.state.players.set(client.sessionId, player);

    client.view = new StateView();
    client.view.add(player);
    this.interest.updateAll(this.viewers(), this.state.players);
    this.markOnline(session);
    this.instanceDirty = true;

    const welcome: WelcomePayload = {
      sessionId: client.sessionId,
      roomId: this.roomId,
      zoneId: this.zoneId,
      serverTime: Date.now(),
      voiceAvailable: this.svc.voice !== null,
      tickRate: NETWORK.serverTickRate,
    };
    client.send(ServerMessage.Welcome, welcome);
    const history = this.history.list();
    if (history.length > 0) client.send(ServerMessage.ChatHistory, history);

    this.svc.metrics.joins++;
    this.log.info("player joined", { sessionId: client.sessionId, userId: claims.sub, clients: this.clients.length });
  }

  override onDrop(client: ZoneClient): void {
    const s = this.sessions.get(client.sessionId);
    // Mid-transfer clients are leaving for another room anyway; onLeave will clean up.
    if (!s || s.transfer) return;
    s.client = null;
    s.voiceEnabled = false;
    s.player.speaking = false;
    const reconnection = this.allowReconnection(client, ZONE_ROOM_RECONNECT_SECONDS);
    // allowReconnection() returns a rejected promise if the client never fully joined.
    void reconnection.catch(() => undefined);
    s.reconnection = reconnection;
    this.log.info("player dropped", { sessionId: client.sessionId });
  }

  override onReconnect(client: ZoneClient): void {
    const s = this.sessions.get(client.sessionId);
    if (!s) return;
    s.client = client;
    s.reconnection = null;
    const shop = this.shopkeepers.shopOf(client.sessionId);
    if (shop) client.send(ServerMessage.ShopEnter, shop);
    this.log.info("player reconnected", { sessionId: client.sessionId });
  }

  override onLeave(client: ZoneClient): void {
    const s = this.sessions.get(client.sessionId);
    if (this.removeSession(client.sessionId, s?.transfer ? "transfer" : "left")) {
      this.svc.metrics.leaves++;
      this.log.info("player left", { sessionId: client.sessionId, clients: this.clients.length });
    }
  }

  override onBeforeShutdown(): void {
    this.broadcast(ServerMessage.System, { text: "This server is restarting. Reconnecting you…" });
    super.onBeforeShutdown();
  }

  override async onDispose(): Promise<void> {
    await this.presence.unsubscribe(chatTopics.zone(this.zoneId), this.onChatPublished);
    await this.presence.unsubscribe(chatTopics.global, this.onChatPublished);
    await this.presence.unsubscribe(USER_CONTROL_CHANNEL, this.onUserControl);
    if (this.shopkeepers.shops.length > 0) await this.presence.unsubscribe(NPC_CONTROL_CHANNEL, this.onNpcControl);
    // Normally empty by now; on shutdown, save whoever is still here before the process exits.
    await this.savePositions([...this.sessions.values()]);
    for (const id of [...this.sessions.keys()]) this.removeSession(id, "dispose");
    await this.svc.store
      .recordInstance({ roomId: this.roomId, zoneId: this.zoneId, serverId: this.svc.serverId, currentPlayers: 0, status: "closed" })
      .catch((err) => this.log.warn("could not record instance", { err }));
    this.svc.metrics.unregisterRoom(this.roomId);
    this.log.info("room disposed");
  }

  override onUncaughtException(error: Error, methodName: string): void {
    this.log.error("uncaught room exception", { method: methodName, err: error });
  }

  // -----------------------------------------------------------------------------------------------
  // Simulation
  // -----------------------------------------------------------------------------------------------

  private tick(deltaMs: number): void {
    const started = performance.now();
    const dt = Math.min(Math.max(deltaMs, 0) / 1000, 0.25);
    const now = Date.now();

    for (const [sessionId, s] of this.sessions) {
      s.sim.locked = s.client === null || s.transfer !== null || s.player.seatId !== "";
      const result = s.sim.tick(dt, this.bounds);
      if (result.rejected > 0) {
        this.svc.metrics.rejectedSteps += result.rejected;
        this.log.warn("movement step rejected", { sessionId, rejected: result.rejected });
      }
      if (result.respawn) this.respawn(s);
      if (s.player.emote && (result.moved || now >= s.emoteUntil)) s.player.emote = "";
      this.syncPlayer(s);

      if (s.transfer) {
        if (now > s.transfer.deadline) s.client?.leave();
      } else if (s.client && !s.player.seatId) {
        const st = s.sim.state;
        const next = resolveZone(this.zoneId, st.x, st.z);
        if (next !== this.zoneId) void this.beginTransfer(s, next, "border", { x: st.x, y: st.y, z: st.z, rotation: st.facing });
      }
    }

    this.tickCount++;
    if (this.tickCount % INTEREST_EVERY_TICKS === 0) this.interest.updateAll(this.viewers(), this.state.players);
    if (this.tickCount % VOICE_EVERY_TICKS === 0) this.updateVoicePeers();
    if (this.tickCount % PRESENCE_EVERY_TICKS === 0) for (const s of this.sessions.values()) this.markOnline(s);
    if (this.tickCount % SAVE_EVERY_TICKS === 0) void this.savePositions([...this.sessions.values()]);
    if (this.instanceDirty && this.tickCount % INSTANCE_EVERY_TICKS === 0) this.writeInstance("open");
    if (this.shopkeepers.size > 0 && this.tickCount % NPC_EVERY_TICKS === 0) this.updateShopkeepers(dt * NPC_EVERY_TICKS);
    if (this.shopkeepers.shops.length > 0 && this.tickCount % NPC_REFRESH_TICKS === 0) void this.refreshShopkeepers();

    this.svc.metrics.recordTick(performance.now() - started, 1000 / NETWORK.serverTickRate);
  }

  private syncPlayer(s: Session): void {
    const st = s.sim.state;
    const p = s.player;
    p.x = st.x;
    p.y = st.y;
    p.z = st.z;
    p.vy = st.vy;
    p.grounded = st.grounded;
    p.rot = st.facing;
    p.seq = s.sim.lastSeq;
    p.anim = p.seatId ? AnimCode.SITTING : p.emote ? AnimCode.EMOTING : s.sim.anim;
  }

  private respawn(s: Session): void {
    this.freeSeat(s);
    const spawn = getZoneLayout(this.zoneId).spawn;
    s.sim.teleport(spawn.x, spawn.y, spawn.z, spawn.rotation);
    s.client?.send(ServerMessage.System, { text: "You were returned to the zone spawn point." });
  }

  /** Validates a spawn point from a ticket; falls back to the zone spawn when it is implausible. */
  private safeSpawn(spawn: GameTicketClaims["spawn"]): GameTicketClaims["spawn"] {
    const zone = getZoneLayout(this.zoneId);
    const finite = [spawn.x, spawn.y, spawn.z, spawn.rotation].every(Number.isFinite);
    const plausible = finite && rectContains(zone.bounds, spawn.x, spawn.z, -8) && spawn.y > -2 && spawn.y < 60;
    return plausible ? spawn : zone.spawn;
  }

  private async beginTransfer(s: Session, zoneId: ZoneId, reason: ZoneTransferPayload["reason"], position: ZoneTransferPayload["position"]): Promise<void> {
    if (s.transfer || !s.client) return;
    this.freeSeat(s);
    s.transfer = { zoneId, deadline: Date.now() + TRANSFER_TIMEOUT_MS };
    s.sim.locked = true;
    try {
      const { ticket } = await this.svc.tickets.sign({
        sub: s.claims.sub,
        username: s.claims.username,
        displayName: s.claims.displayName,
        zoneId,
        spawn: position,
        ...(s.claims.guest ? { guest: true } : {}),
      });
      if (!s.client || !this.sessions.has(s.client.sessionId)) return;
      const payload: ZoneTransferPayload = { zoneId, ticket, position, reason };
      s.client.send(ServerMessage.ZoneTransfer, payload);
      this.svc.metrics.transfers++;
      this.log.info("zone transfer", { sessionId: s.client.sessionId, to: zoneId, reason });
    } catch (e) {
      s.transfer = null;
      this.log.error("zone transfer failed", { err: e });
      this.sendError(s, { code: "transfer_failed", message: "Could not move you to the next area. Try again." });
    }
  }

  private viewers(): ZoneClient[] {
    return this.clients as unknown as ZoneClient[];
  }

  // -----------------------------------------------------------------------------------------------
  // Messages
  // -----------------------------------------------------------------------------------------------

  /** Registers a handler with validation; malformed payloads count as strikes instead of closing the socket. */
  private handle<T>(type: string, schema: ZodType<T>, handler: (s: Session, message: T) => void | Promise<void>): void {
    this.onMessage(type, (client: ZoneClient, raw: unknown) => {
      const s = this.sessions.get(client.sessionId);
      if (!s || s.client !== client) return;
      const parsed = schema.safeParse(raw ?? {});
      if (!parsed.success) {
        this.strike(s, { code: "invalid_message", message: `Invalid "${type}" message` });
        return;
      }
      return handler(s, parsed.data);
    });
  }

  private registerMessages(): void {
    this.handle(ClientMessage.Input, inputMessageSchema, (s, m) => {
      const result = s.sim.enqueue(m.frames);
      if (result.rejected > 0) {
        this.svc.metrics.rejectedInputs += result.rejected;
        this.strike(s, null);
      }
    });

    this.handle(ClientMessage.Chat, chatMessageSchema, (s, m) => {
      const text = sanitizeChatText(m.text);
      if (!text) return;
      const bucket = m.channel === "global" ? s.limits.globalChat : m.channel === "zone" ? s.limits.zoneChat : s.limits.roomChat;
      if (!this.allow(s, bucket, "You're sending messages too quickly.")) return;
      const message: ChatBroadcast = {
        id: randomUUID(),
        channel: m.channel,
        from: { userId: s.claims.sub, username: s.claims.username, displayName: s.claims.displayName, sessionId: s.client!.sessionId },
        text,
        zoneId: this.zoneId,
        ts: Date.now(),
      };
      this.svc.metrics.chatMessages++;
      if (m.channel === "room") this.deliverChat(message);
      else this.presence.publish(m.channel === "zone" ? chatTopics.zone(this.zoneId) : chatTopics.global, message);
    });

    this.handle(ClientMessage.Emote, emoteMessageSchema, (s, m) => {
      if (s.player.seatId || s.transfer) return;
      if (!this.allow(s, s.limits.emote)) return;
      s.player.emote = m.emote;
      s.emoteUntil = Date.now() + EMOTE_DURATION_MS[m.emote];
      this.syncPlayer(s);
    });

    this.handle(ClientMessage.Interact, interactMessageSchema, (s, m) => {
      if (s.transfer || !this.allow(s, s.limits.interact)) return;
      const target = this.reachable(s, m.objectId);
      if (!target) return;
      if (target.kind === "seat") this.sit(s, target);
      else if (target.kind === "fountain") this.toggleFountain(target);
      else this.sendError(s, { code: "not_interactive", message: "Nothing happens." });
    });

    this.handle(ClientMessage.Stand, voidSchema, (s) => this.standUp(s));

    this.handle(ClientMessage.Travel, travelMessageSchema, (s, m) => {
      if (s.transfer || !this.allow(s, s.limits.travel, "The transit system needs a moment.")) return;
      const kiosk = this.reachable(s, m.kioskId);
      if (!kiosk) return;
      if (kiosk.kind !== "kiosk") {
        this.sendError(s, { code: "not_kiosk", message: "That is not a transit kiosk." });
        return;
      }
      const spawn = getZoneLayout(m.zoneId).spawn;
      this.freeSeat(s);
      if (m.zoneId === this.zoneId) {
        s.sim.teleport(spawn.x, spawn.y, spawn.z, spawn.rotation);
        this.syncPlayer(s);
        return;
      }
      void this.beginTransfer(s, m.zoneId, "travel", { ...spawn });
    });

    this.handle(ClientMessage.VoiceJoin, voidSchema, async (s) => {
      const voice = this.svc.voice;
      if (!voice) {
        this.sendError(s, { code: "voice_unavailable", message: "Voice chat is not available on this server." });
        return;
      }
      if (!this.allow(s, s.limits.voice)) return;
      try {
        const payload = await voice.token(this.roomId, s.claims.sub, s.claims.displayName);
        if (!s.client) return;
        s.voiceEnabled = true;
        s.lastVoicePeers = "";
        s.player.voice = true;
        s.client.send(ServerMessage.VoiceToken, payload);
      } catch (e) {
        this.log.error("voice token failed", { err: e });
        this.sendError(s, { code: "voice_failed", message: "Could not join voice chat." });
      }
    });

    this.handle(ClientMessage.VoiceState, voiceStateSchema, (s, m) => {
      if (!s.voiceEnabled || !s.limits.voiceState.take()) return;
      s.player.voice = !m.muted;
      s.player.speaking = !m.muted && m.speaking === true;
    });

    this.handle(ClientMessage.AvatarRefresh, voidSchema, async (s) => {
      if (!this.allow(s, s.limits.avatar)) return;
      s.player.avatar = JSON.stringify(await this.loadAvatar(s.claims));
    });

    this.handle(ClientMessage.Ping, pingSchema, (s, m) => {
      if (s.limits.ping.take()) s.client?.send(ServerMessage.Pong, { t: m.t });
    });

    this.onMessage("*", (client: ZoneClient, type: unknown) => {
      const s = this.sessions.get(client.sessionId);
      if (s) this.strike(s, { code: "unknown_message", message: `Unknown message "${String(type).slice(0, 40)}"` });
    });
  }

  private allow(s: Session, bucket: TokenBucket, message = "Slow down a little."): boolean {
    if (bucket.take()) return true;
    this.strike(s, { code: "rate_limited", message });
    return false;
  }

  /** Records a protocol violation; too many in a short window removes the client. */
  private strike(s: Session, error: ErrorPayload | null): void {
    if (s.strikes.add()) {
      this.svc.metrics.kicks++;
      this.log.warn("client kicked for protocol abuse", { sessionId: s.client?.sessionId, userId: s.claims.sub });
      this.endSession(s, CloseReason.Kicked, "Too many invalid requests");
      return;
    }
    if (error) this.sendError(s, error);
  }

  private sendError(s: Session, error: ErrorPayload): void {
    s.client?.send(ServerMessage.Error, error);
  }

  private deliverChat(message: ChatBroadcast): void {
    if (message.channel === "zone" && message.zoneId !== this.zoneId) return;
    this.history.push(message);
    this.broadcast(ServerMessage.Chat, message);
  }

  // -----------------------------------------------------------------------------------------------
  // Interactions
  // -----------------------------------------------------------------------------------------------

  /** Returns the object if it exists in this zone and the player stands within its interaction radius. */
  private reachable(s: Session, objectId: string): InteractiveObject | null {
    const o = getInteractive(objectId);
    if (!o || o.zoneId !== this.zoneId) {
      this.sendError(s, { code: "unknown_object", message: "That object isn't here." });
      return null;
    }
    const st = s.sim.state;
    if (distance2D(st.x, st.z, o.x, o.z) > o.radius + INTERACT_TOLERANCE) {
      this.sendError(s, { code: "too_far", message: `Move closer to the ${o.label.toLowerCase()}.` });
      return null;
    }
    return o;
  }

  private sit(s: Session, seat: InteractiveObject): void {
    if (s.player.seatId) return;
    const obj = this.state.objects.get(seat.id);
    if (!obj) return;
    if (obj.occupant && obj.occupant !== s.client?.sessionId) {
      this.sendError(s, { code: "seat_taken", message: "Someone is already sitting there." });
      return;
    }
    obj.occupant = s.client!.sessionId;
    s.player.seatId = seat.id;
    s.player.emote = "";
    s.sim.teleport(seat.x, 0, seat.z, seat.rotation);
    s.sim.state.grounded = true;
    s.sim.locked = true;
    this.syncPlayer(s);
  }

  private standUp(s: Session): void {
    if (!s.player.seatId) return;
    const seat = getInteractive(s.player.seatId);
    this.freeSeat(s);
    const st = s.sim.state;
    const facing = seat?.rotation ?? st.facing;
    s.sim.teleport(st.x - Math.sin(facing) * 0.8, st.y, st.z - Math.cos(facing) * 0.8, facing);
    this.syncPlayer(s);
  }

  private freeSeat(s: Session): void {
    if (!s.player.seatId) return;
    const obj = this.state.objects.get(s.player.seatId);
    if (obj && obj.occupant === s.client?.sessionId) obj.occupant = "";
    s.player.seatId = "";
  }

  private toggleFountain(fountain: InteractiveObject): void {
    const now = Date.now();
    if ((this.fountainCooldown.get(fountain.id) ?? 0) > now) return;
    this.fountainCooldown.set(fountain.id, now + 1500);
    const obj = this.state.objects.get(fountain.id);
    if (obj) obj.active = !obj.active;
  }

  // -----------------------------------------------------------------------------------------------
  // Voice and sessions
  // -----------------------------------------------------------------------------------------------

  private updateVoicePeers(): void {
    const participants: { userId: string; x: number; z: number; s: Session }[] = [];
    for (const s of this.sessions.values()) {
      if (s.voiceEnabled && s.client) participants.push({ userId: s.claims.sub, x: s.sim.state.x, z: s.sim.state.z, s });
    }
    for (const p of participants) {
      const peers = computeVoicePeers(p, participants);
      const key = JSON.stringify(peers);
      if (key === p.s.lastVoicePeers) continue;
      p.s.lastVoicePeers = key;
      p.s.client?.send(ServerMessage.VoicePeers, { peers });
    }
  }

  /** One account, one avatar: a new join replaces any older session of the same user in this room. */
  private replaceDuplicateSessions(userId: string): void {
    for (const [sessionId, other] of this.sessions) {
      if (other.claims.sub !== userId) continue;
      if (other.client) other.client.leave(CloseReason.DuplicateSession, "Signed in from another window");
      else other.reconnection?.reject?.(new Error("Replaced by a new session"));
      this.removeSession(sessionId, "replaced");
      this.log.info("replaced duplicate session", { sessionId, userId });
    }
  }

  private removeSession(sessionId: string, reason: EndReason): boolean {
    const s = this.sessions.get(sessionId);
    if (!s) return false;
    // A transferring player is saved by the room they move to; a replaced one by their new session.
    if (reason === "left") void this.savePositions([s]);
    if (reason === "left" || reason === "dispose") this.markOffline(s);
    this.instanceDirty = true;
    if (s.player.seatId) {
      const obj = this.state.objects.get(s.player.seatId);
      if (obj && obj.occupant === sessionId) obj.occupant = "";
    }
    s.sim.dispose();
    this.shopkeepers.forget(sessionId);
    this.sessions.delete(sessionId);
    this.state.players.delete(sessionId);
    return true;
  }

  // -----------------------------------------------------------------------------------------------
  // AI shopkeepers
  // -----------------------------------------------------------------------------------------------

  /** Places the zone's open AI shopkeepers (and removes closed ones). Never blocks the tick. */
  private async refreshShopkeepers(): Promise<void> {
    try {
      const { added, removed } = this.shopkeepers.sync(await this.svc.store.shopkeepers(this.zoneId));
      for (const id of removed) this.state.npcs.delete(id);
      for (const npc of added) this.state.npcs.set(npc.id, npc);
    } catch (err) {
      this.log.warn("could not load shopkeepers", { err });
    }
  }

  private updateShopkeepers(dt: number): void {
    const customers = [];
    for (const [sessionId, s] of this.sessions) {
      customers.push({ sessionId, x: s.player.x, z: s.player.z, present: s.client !== null && s.transfer === null && s.player.seatId === "" });
    }
    for (const e of this.shopkeepers.update(customers, dt)) {
      this.sessions.get(e.sessionId)?.client?.send(e.type === "enter" ? ServerMessage.ShopEnter : ServerMessage.ShopLeave, e.payload);
    }
  }

  // -----------------------------------------------------------------------------------------------
  // Persistence, presence and commands from the API
  // -----------------------------------------------------------------------------------------------

  private loadAvatar(claims: GameTicketClaims) {
    return this.svc.store.avatar(claims.sub, claims.username).catch((err) => {
      this.log.warn("could not load avatar", { userId: claims.sub, err });
      return generateAvatar(claims.username);
    });
  }

  /** Writes positions of account holders (never guests) that changed since the last save. */
  private async savePositions(list: Session[]): Promise<void> {
    const rows = [];
    for (const s of list) {
      if (s.claims.guest || s.transfer) continue;
      const st = s.sim.state;
      const row = { userId: s.claims.sub, zoneId: this.zoneId, x: round(st.x), y: round(st.y), z: round(st.z), rotation: round(st.facing) };
      const key = `${row.x},${row.y},${row.z},${row.rotation}`;
      if (key === s.savedKey) continue;
      s.savedKey = key;
      rows.push(row);
    }
    if (rows.length === 0) return;
    try {
      await this.svc.store.savePositions(rows);
    } catch (err) {
      for (const s of list) s.savedKey = "";
      this.log.warn("could not save positions", { count: rows.length, err });
    }
  }

  private writeInstance(status: "open" | "closed"): void {
    this.instanceDirty = false;
    void this.svc.store
      .recordInstance({ roomId: this.roomId, zoneId: this.zoneId, serverId: this.svc.serverId, currentPlayers: this.sessions.size, status })
      .catch((err) => this.log.warn("could not record instance", { err }));
  }

  /** Friends see which zone a player is in through `ew:online:<userId>` (read by the API). */
  private markOnline(s: Session): void {
    if (s.claims.guest || s.transfer) return;
    void Promise.resolve(this.presence.setex(onlineKey(s.claims.sub), this.zoneId, ONLINE_TTL_SECONDS)).catch(() => undefined);
  }

  private markOffline(s: Session): void {
    if (s.claims.guest) return;
    const key = onlineKey(s.claims.sub);
    // Only clear our own entry: the player may already be online in another zone.
    void Promise.resolve(this.presence.get(key))
      .then((zone) => {
        if (zone === this.zoneId) return this.presence.del(key);
      })
      .catch(() => undefined);
  }

  private handleUserControl(raw: unknown): void {
    const parsed = userControlSchema.safeParse(raw);
    if (!parsed.success) return;
    const command = parsed.data;
    for (const [sessionId, s] of [...this.sessions]) {
      if (s.claims.sub !== command.userId) continue;
      if (command.type === "call") {
        s.client?.send(ServerMessage.CallEvent, command.event);
        continue;
      }
      if (command.type === "avatar_changed") {
        void this.loadAvatar(s.claims).then((avatar) => {
          if (this.sessions.get(sessionId) === s) s.player.avatar = JSON.stringify(avatar);
        });
        continue;
      }
      this.log.info("disconnecting user on request", { sessionId, userId: s.claims.sub, reason: command.reason });
      this.endSession(s, CloseReason.SignedOut, command.reason === "suspended" ? "Account suspended" : "Signed out");
    }
  }

  /**
   * Removes a player for good. The session goes first: a close with an application code reaches
   * the room as a drop, and onDrop would otherwise hold the seat open for reconnection.
   */
  private endSession(s: Session, code: number, reason: string): void {
    const sessionId = [...this.sessions].find(([, other]) => other === s)?.[0];
    if (sessionId) this.removeSession(sessionId, "left");
    if (s.client) s.client.leave(code, reason);
    else s.reconnection?.reject?.(new Error(reason));
  }
}

const round = (v: number) => Math.round(v * 1000) / 1000;

const voidSchema = z.object({}).strict();
