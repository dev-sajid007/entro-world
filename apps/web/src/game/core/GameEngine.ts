import * as THREE from "three";
import { DEFAULT_ZONE, NETWORK, type AvatarConfig, type WorldJoinResponse, type ZoneId } from "@entroworld/shared";
import { EMOTES, type EmoteId } from "@entroworld/avatar";
import { PhysicsWorld, SIM } from "@entroworld/game-engine";
import { CloseReason, isFinalCloseCode } from "@entroworld/game-protocol";
import type {
  CallEvent,
  ChatBroadcast,
  ChatChannel,
  InputFrame,
  NpcStateShape,
  ObjectStateShape,
  PlayerStateShape,
  ShopPresencePayload,
  VoicePeer,
  VoiceTokenPayload,
  ZoneTransferPayload,
} from "@entroworld/game-protocol";
import {
  findNearestInteractive,
  getCityLayout,
  getInteractive,
  getZoneLayout,
  resolveZone,
  type InteractiveKind,
  type InteractiveObject,
} from "@entroworld/world-assets";
import { distanceToRect } from "@entroworld/shared";
import { CameraController } from "../camera/CameraController";
import { InputManager, type InputAction } from "../controls/InputManager";
import { LocalPlayer } from "../entities/LocalPlayer";
import { RemotePlayer } from "../entities/RemotePlayer";
import { Shopkeeper } from "../entities/Shopkeeper";
import { animateMaterials } from "../assets/materials";
import { ZoneConnection, type ConnectionStatus } from "../../multiplayer/ZoneConnection";
import { Emitter } from "./Emitter";
import { FixedStepper } from "./FixedStepper";
import { Store } from "./Store";

export type ChunkLevel = "high" | "low" | "hidden";

export interface NearbyInteractive {
  id: string;
  kind: InteractiveKind;
  label: string;
  ref?: string | undefined;
}

export interface GameUiState {
  status: ConnectionStatus;
  zoneId: ZoneId;
  playersInView: number;
  nearby: NearbyInteractive | null;
  seated: boolean;
  fps: number;
  latency: number | null;
  pointerLocked: boolean;
  x: number;
  z: number;
  voiceAvailable: boolean;
  error: string | null;
  /** The AI shop counter the player is standing at (from the game server), if any. */
  shop: ShopPresencePayload | null;
}

export interface ChatEntry extends ChatBroadcast {
  self: boolean;
}

export interface EngineEvents extends Record<string, unknown> {
  openPanel: { kind: InteractiveKind; object: InteractiveObject };
  chatFocus: undefined;
  escape: undefined;
  toggleHelp: undefined;
  toggleVoice: undefined;
  voiceToken: VoiceTokenPayload;
  voicePeers: VoicePeer[];
  callEvent: CallEvent;
  propertyChanged: { plotId: string };
  eventUpdate: { eventId: string };
  system: string;
  zoneChanged: ZoneId;
  shopEnter: ShopPresencePayload;
  shopLeave: ShopPresencePayload;
}

export interface OnlineOptions {
  /** Requests a room connection ticket from the API (optionally for a specific zone). */
  requestTicket: (zoneId?: ZoneId) => Promise<WorldJoinResponse>;
}

export interface EngineOptions {
  userId: string | null;
  username: string;
  displayName: string;
  avatar: AvatarConfig;
  online: OnlineOptions | null;
  /** Users whose chat should be hidden (blocked). */
  isBlocked?: (userId: string) => boolean;
}

const CHUNK_HIGH = 95;
const CHUNK_LOW = 330;
const INPUT_SEND_INTERVAL_STEPS = 2;

function resolveEndpoint(url: string): string {
  if (/^wss?:|^https?:/.test(url)) return url;
  return new URL(url, window.location.href).toString().replace(/\/$/, "");
}

/**
 * The imperative core of the client. Owns physics, input, camera, players and the network
 * connection, and is driven by a single `update(dt)` call per animation frame. React reads from
 * its stores (throttled) and never re-renders per frame.
 */
export class GameEngine {
  readonly root = new THREE.Group();
  readonly events = new Emitter<EngineEvents>();
  readonly input = new InputManager();
  readonly ui: Store<GameUiState>;
  readonly chat = new Store<{ entries: ChatEntry[] }>({ entries: [] });
  readonly chunks = new Store<{ levels: Record<string, ChunkLevel> }>({ levels: {} });
  readonly objects = new Map<string, ObjectStateShape>();
  readonly objectsVersion = new Store<{ version: number }>({ version: 0 });
  /** World position the camera focuses on (read by lights and other scene components). */
  readonly focus = new THREE.Vector3();
  readonly remotes = new Map<string, RemotePlayer>();
  /** AI shopkeepers in the current zone, by NPC id. */
  readonly npcs = new Map<string, Shopkeeper>();
  readonly local: LocalPlayer;
  camera: CameraController | null = null;
  private cameraObject: THREE.PerspectiveCamera | null = null;
  private connection: ZoneConnection | null = null;
  private readonly stepper = new FixedStepper(SIM.dt);
  private outbox: InputFrame[] = [];
  private stepsSinceSend = 0;
  private zoneId: ZoneId;
  private frameCount = 0;
  private fpsTime = 0;
  private uiTimer = 0;
  private chunkTimer = 1;
  private elapsed = 0;
  private transferring = false;
  private disposed = false;
  private rejoinAttempts = 0;
  private readonly unsubscribers: (() => void)[] = [];

  private constructor(
    readonly physics: PhysicsWorld,
    private readonly options: EngineOptions,
    spawn: { zoneId: ZoneId; x: number; y: number; z: number; rotation: number },
  ) {
    this.zoneId = spawn.zoneId;
    const character = physics.createCharacter(spawn.x, spawn.y, spawn.z, spawn.rotation);
    this.local = new LocalPlayer(physics, character, options.displayName, options.avatar);
    this.root.add(this.local.root);
    this.ui = new Store<GameUiState>({
      status: options.online ? "connecting" : "offline",
      zoneId: spawn.zoneId,
      playersInView: 0,
      nearby: null,
      seated: false,
      fps: 0,
      latency: null,
      pointerLocked: false,
      x: spawn.x,
      z: spawn.z,
      voiceAvailable: false,
      error: null,
      shop: null,
    });
    this.focus.set(spawn.x, spawn.y, spawn.z);
    this.unsubscribers.push(this.input.on("action", (a) => this.onAction(a)));
    this.unsubscribers.push(this.input.on("pointerLock", (locked) => this.ui.set({ pointerLocked: locked })));
  }

  static async create(options: EngineOptions): Promise<GameEngine> {
    const physics = await PhysicsWorld.create();
    let ticket: WorldJoinResponse | null = null;
    let spawn = { zoneId: DEFAULT_ZONE as ZoneId, ...getZoneLayout(DEFAULT_ZONE).spawn };
    if (options.online) {
      ticket = await options.online.requestTicket();
      spawn = { zoneId: ticket.zoneId, ...ticket.spawn };
    }
    const engine = new GameEngine(physics, options, spawn);
    if (ticket) await engine.connect(ticket);
    return engine;
  }

  get currentZone(): ZoneId {
    return this.zoneId;
  }

  get isOnline(): boolean {
    return this.connection !== null;
  }

  get sessionId(): string | null {
    return this.connection?.sessionId ?? null;
  }

  // ---------------------------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------------------------

  attach(element: HTMLElement, camera: THREE.PerspectiveCamera): void {
    this.cameraObject = camera;
    this.camera = new CameraController(camera, this.physics);
    this.camera.snapBehind(this.local.character.state.facing);
    this.input.attach(element);
  }

  detach(): void {
    this.input.detach();
    this.camera = null;
    this.cameraObject = null;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    for (const u of this.unsubscribers) u();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.clearNpcs();
    const connection = this.connection;
    this.connection = null;
    if (connection) await connection.leave();
    this.local.dispose();
    this.physics.dispose();
    this.events.clear();
  }

  // ---------------------------------------------------------------------------------------------
  // Networking
  // ---------------------------------------------------------------------------------------------

  private async connect(ticket: WorldJoinResponse): Promise<void> {
    this.ui.set({ status: "connecting", error: null });
    this.gameEndpoint = ticket.gameServerUrl;
    const connection = await ZoneConnection.connect(resolveEndpoint(ticket.gameServerUrl), ticket.zoneId, ticket.ticket);
    if (this.disposed) {
      await connection.leave();
      return;
    }
    this.bindConnection(connection);
  }

  private bindConnection(connection: ZoneConnection): void {
    this.connection = connection;
    this.zoneId = connection.zoneId;
    this.local.online = true;
    this.local.predicted.reset(1);
    this.rejoinAttempts = 0;
    this.ui.set({ status: "connected", zoneId: connection.zoneId });
    this.events.emit("zoneChanged", connection.zoneId);
    const mySession = connection.sessionId;

    connection.on("status", (status) => this.ui.set({ status }));
    connection.on("welcome", (w) => this.ui.set({ voiceAvailable: w.voiceAvailable }));
    connection.on("playerAdd", ({ sessionId, player }) => this.onPlayerState(sessionId, player, mySession));
    connection.on("playerChange", ({ sessionId, player }) => this.onPlayerState(sessionId, player, mySession));
    connection.on("playerRemove", ({ sessionId }) => {
      this.remotes.get(sessionId)?.dispose();
      this.remotes.delete(sessionId);
    });
    connection.on("objectChange", ({ id, object }) => {
      this.objects.set(id, { id: object.id, kind: object.kind, occupant: object.occupant, active: object.active, value: object.value });
      this.objectsVersion.set({ version: this.objectsVersion.get().version + 1 });
    });
    connection.on("npcChange", ({ id, npc }) => this.onNpcState(id, npc));
    connection.on("npcRemove", ({ id }) => {
      this.npcs.get(id)?.dispose();
      this.npcs.delete(id);
    });
    connection.on("shopEnter", (shop) => {
      this.ui.set({ shop });
      this.events.emit("shopEnter", shop);
    });
    connection.on("shopLeave", (shop) => {
      if (this.ui.get().shop?.shopSlug === shop.shopSlug) this.ui.set({ shop: null });
      this.events.emit("shopLeave", shop);
    });
    connection.on("chat", (m) => this.addChat(m));
    connection.on("chatHistory", (list) => {
      for (const m of list) this.addChat(m, false);
    });
    connection.on("system", (m) => this.events.emit("system", m.text));
    connection.on("error", (e) => this.ui.set({ error: e.message }));
    connection.on("transfer", (t) => void this.handleTransfer(t));
    connection.on("voiceToken", (t) => this.events.emit("voiceToken", t));
    connection.on("voicePeers", (p) => this.events.emit("voicePeers", p.peers));
    connection.on("callEvent", (e) => this.events.emit("callEvent", e));
    connection.on("propertyChanged", (p) => this.events.emit("propertyChanged", p));
    connection.on("eventUpdate", (p) => this.events.emit("eventUpdate", p));
    connection.on("latency", (ms) => this.ui.set({ latency: Math.round(ms) }));
    connection.on("left", ({ code, consented }) => {
      if (consented || this.disposed || this.transferring) return;
      this.connection = null;
      this.local.online = false;
      if (isFinalCloseCode(code)) {
        // Rejoining would just bounce between two windows (or straight back into a kick).
        const error =
          code === CloseReason.DuplicateSession
            ? "You entered the world from another window."
            : code === CloseReason.SignedOut
              ? "You left the world or signed out on another device."
              : "You were disconnected by the server.";
        this.ui.set({ status: "disconnected", error });
        return;
      }
      void this.rejoin();
    });
  }

  private onPlayerState(sessionId: string, p: PlayerStateShape, mySession: string): void {
    if (sessionId === mySession) {
      this.local.applyServerState({ x: p.x, y: p.y, z: p.z, vy: p.vy, grounded: p.grounded, rot: p.rot, seq: p.seq, anim: p.anim, emote: p.emote, seatId: p.seatId });
      return;
    }
    let remote = this.remotes.get(sessionId);
    if (!remote) {
      remote = new RemotePlayer(sessionId, p.userId, p.displayName, p.username, p.avatar);
      this.remotes.set(sessionId, remote);
      this.root.add(remote.root);
    }
    remote.setAvatar(p.avatar);
    if (remote.displayName !== p.displayName) remote.setDisplayName(p.displayName);
    remote.anim = p.anim;
    remote.emote = p.emote;
    remote.seatId = p.seatId;
    remote.setVoice(p.voice, p.speaking);
    remote.push({ t: performance.now(), x: p.x, y: p.y, z: p.z, rot: p.rot }, NETWORK.patchRateMs);
  }

  private onNpcState(id: string, n: NpcStateShape): void {
    const existing = this.npcs.get(id);
    if (existing) {
      existing.apply(n);
      return;
    }
    const npc = new Shopkeeper(id, n.agentId, n.shopSlug, n.name, n);
    this.npcs.set(id, npc);
    this.root.add(npc.root);
  }

  private clearNpcs(): void {
    for (const n of this.npcs.values()) n.dispose();
    this.npcs.clear();
    if (this.ui.get().shop) this.ui.set({ shop: null });
  }

  /** The shopkeeper NPC for an AI agent, if it stands in this zone. */
  shopkeeper(agentId: string): Shopkeeper | undefined {
    for (const n of this.npcs.values()) if (n.agentId === agentId) return n;
    return undefined;
  }

  private addChat(m: ChatBroadcast, showBubble = true): void {
    if (this.options.isBlocked?.(m.from.userId)) return;
    const self = m.from.sessionId === this.connection?.sessionId || m.from.userId === this.options.userId;
    const entries = [...this.chat.get().entries, { ...m, self }].slice(-120);
    this.chat.set({ entries });
    if (!showBubble || m.channel === "global") return;
    const now = performance.now();
    if (self) this.local.bubble.show(m.text, now);
    else {
      for (const r of this.remotes.values()) if (r.sessionId === m.from.sessionId) r.bubble.show(m.text, now);
    }
  }

  private async handleTransfer(t: ZoneTransferPayload): Promise<void> {
    if (this.transferring || this.disposed) return;
    this.transferring = true;
    this.ui.set({ status: "transferring" });
    this.local.frozen = true;
    this.flushInputs();
    const old = this.connection;
    this.connection = null;
    this.local.online = false;
    if (old) await old.leave();
    for (const r of this.remotes.values()) r.dispose();
    this.remotes.clear();
    this.clearNpcs();
    this.objects.clear();
    this.objectsVersion.set({ version: this.objectsVersion.get().version + 1 });
    const s = this.local.character.state;
    if (t.reason === "travel" || Math.hypot(s.x - t.position.x, s.z - t.position.z) > 3) {
      this.local.teleport(t.position.x, t.position.y, t.position.z, t.position.rotation);
      if (t.reason === "travel") this.camera?.snapBehind(t.position.rotation);
    }
    try {
      const connection = await ZoneConnection.connect(resolveEndpoint(this.gameEndpoint ?? "/game"), t.zoneId, t.ticket);
      if (this.disposed) {
        await connection.leave();
        return;
      }
      this.bindConnection(connection);
    } catch {
      await this.rejoin(t.zoneId);
    } finally {
      this.local.frozen = false;
      this.transferring = false;
    }
  }

  private gameEndpoint: string | null = "/game";

  private async rejoin(zoneId?: ZoneId): Promise<void> {
    if (!this.options.online || this.disposed) return;
    this.ui.set({ status: "reconnecting" });
    while (!this.disposed && this.rejoinAttempts < 6) {
      this.rejoinAttempts++;
      try {
        const ticket = await this.options.online.requestTicket(zoneId ?? this.zoneId);
        this.gameEndpoint = ticket.gameServerUrl;
        this.local.teleport(ticket.spawn.x, ticket.spawn.y, ticket.spawn.z, ticket.spawn.rotation);
        await this.connect(ticket);
        return;
      } catch {
        await new Promise((r) => setTimeout(r, Math.min(8000, 500 * 2 ** this.rejoinAttempts)));
      }
    }
    if (!this.disposed) this.ui.set({ status: "disconnected", error: "Lost connection to the world server." });
  }

  /** Manually retries after a final disconnect. */
  retryConnection(): void {
    this.rejoinAttempts = 0;
    void this.rejoin();
  }

  private flushInputs(): void {
    if (this.outbox.length > 0) this.connection?.sendInputs(this.outbox);
    this.outbox = [];
    this.stepsSinceSend = 0;
  }

  // ---------------------------------------------------------------------------------------------
  // Actions (called by input and the HUD)
  // ---------------------------------------------------------------------------------------------

  private onAction(action: InputAction): void {
    switch (action) {
      case "interact":
        this.interact();
        break;
      case "chat":
        this.events.emit("chatFocus", undefined);
        break;
      case "escape":
        this.events.emit("escape", undefined);
        break;
      case "toggleHelp":
        this.events.emit("toggleHelp", undefined);
        break;
      case "toggleVoice":
        this.events.emit("toggleVoice", undefined);
        break;
      default:
        if (action.startsWith("emote")) {
          const id = EMOTES[Number(action.slice(5)) - 1];
          if (id) this.emote(id);
        }
    }
  }

  sendChat(channel: ChatChannel, text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (this.connection) {
      this.connection.chat(channel, trimmed);
      return;
    }
    this.addChat({
      id: crypto.randomUUID(),
      channel,
      from: { userId: this.options.userId ?? "local", username: this.options.username, displayName: this.options.displayName, sessionId: "local" },
      text: trimmed,
      zoneId: this.zoneId,
      ts: Date.now(),
    });
  }

  emote(id: EmoteId): void {
    if (this.local.seated) return;
    this.local.playEmote(id, performance.now());
    this.connection?.emote(id);
  }

  /** Interacts with the nearest interactive object, if any. */
  interact(): void {
    const s = this.local.character.state;
    if (this.local.seated) {
      this.standUp();
      return;
    }
    const target = findNearestInteractive(s.x, s.z, (o) => o.kind !== "seat" || !this.isSeatTaken(o.id));
    if (!target) return;
    switch (target.kind) {
      case "seat":
      case "fountain":
        if (this.connection) this.connection.interact(target.id);
        else if (target.kind === "seat") {
          this.local.applyServerState({ x: target.x, y: 0, z: target.z, vy: 0, grounded: true, rot: target.rotation, seq: 0, anim: 5, emote: "", seatId: target.id });
        } else {
          const prev = this.objects.get(target.id);
          this.objects.set(target.id, { id: target.id, kind: "fountain", occupant: "", active: !(prev?.active ?? true), value: "" });
          this.objectsVersion.set({ version: this.objectsVersion.get().version + 1 });
        }
        break;
      default:
        this.events.emit("openPanel", { kind: target.kind, object: target });
    }
  }

  private isSeatTaken(id: string): boolean {
    const o = this.objects.get(id);
    return !!o?.occupant && o.occupant !== this.connection?.sessionId;
  }

  standUp(): void {
    if (!this.local.seated) return;
    if (this.connection) this.connection.stand();
    else {
      const s = this.local.character.state;
      const seat = getInteractive(this.local.seatId);
      const fx = seat ? -Math.sin(seat.rotation) * 0.8 : 0;
      const fz = seat ? -Math.cos(seat.rotation) * 0.8 : 0;
      this.local.seatId = "";
      this.local.teleport(s.x + fx, 0, s.z + fz, s.facing);
    }
  }

  /** Fast travel through a transit kiosk. */
  travel(kioskId: string, zoneId: ZoneId): void {
    if (this.connection) {
      this.connection.travel(kioskId, zoneId);
      return;
    }
    const spawn = getZoneLayout(zoneId).spawn;
    this.local.teleport(spawn.x, spawn.y, spawn.z, spawn.rotation);
    this.camera?.snapBehind(spawn.rotation);
    this.zoneId = zoneId;
    this.ui.set({ zoneId });
  }

  refreshAvatar(avatar: AvatarConfig): void {
    this.local.rig.setConfig(avatar);
    this.connection?.refreshAvatar();
  }

  requestVoiceToken(): void {
    this.connection?.requestVoice();
  }

  setVoiceState(muted: boolean, speaking?: boolean): void {
    this.connection?.voiceState(muted, speaking);
  }

  remoteByUserId(userId: string): RemotePlayer | undefined {
    for (const r of this.remotes.values()) if (r.userId === userId) return r;
    return undefined;
  }

  // ---------------------------------------------------------------------------------------------
  // Frame update
  // ---------------------------------------------------------------------------------------------

  update(frameDt: number): void {
    if (this.disposed) return;
    const dt = Math.min(frameDt, 0.1);
    const now = performance.now();
    this.elapsed += dt;

    const look = this.input.consumeLook();
    this.camera?.applyLook(look.dx, look.dy, look.zoom);
    const yaw = this.camera?.yaw ?? 0;

    if (this.local.seated && this.input.movementIntent) this.standUp();
    this.input.movementIntent = false;

    const alpha = this.stepper.advance(frameDt, () => {
      const frame = this.local.step(this.input.buttons(), yaw);
      if (frame && this.connection) {
        this.outbox.push(frame);
        this.stepsSinceSend++;
        if (this.stepsSinceSend >= INPUT_SEND_INTERVAL_STEPS) this.flushInputs();
      }
    });

    const cameraPos = this.cameraObject?.position ?? this.focus;
    this.local.update(alpha, dt, now, cameraPos.distanceTo(this.local.renderPosition));
    this.focus.copy(this.local.renderPosition);
    this.camera?.update(dt, this.local.renderPosition);

    const renderTime = now - NETWORK.interpolationDelayMs;
    for (const r of this.remotes.values()) r.update(renderTime, dt, now, cameraPos);
    for (const n of this.npcs.values()) n.update(dt, now, cameraPos);

    animateMaterials(this.elapsed);

    // Throttled bookkeeping.
    this.frameCount++;
    this.fpsTime += frameDt;
    this.uiTimer += frameDt;
    this.chunkTimer += frameDt;
    if (this.chunkTimer > 0.25) {
      this.chunkTimer = 0;
      this.updateChunks();
    }
    if (this.uiTimer > 0.2) {
      this.uiTimer = 0;
      this.updateUi();
    }
  }

  private updateUi(): void {
    const s = this.local.character.state;
    const fps = this.fpsTime > 0 ? Math.round(this.frameCount / this.fpsTime) : 0;
    if (this.fpsTime > 1) {
      this.frameCount = 0;
      this.fpsTime = 0;
    }
    const nearbyObj = this.local.seated
      ? null
      : findNearestInteractive(s.x, s.z, (o) => o.kind !== "seat" || !this.isSeatTaken(o.id));
    const nearby: NearbyInteractive | null = nearbyObj ? { id: nearbyObj.id, kind: nearbyObj.kind, label: nearbyObj.label, ref: nearbyObj.ref } : null;
    const current = this.ui.get().nearby;
    const zoneId = this.connection ? this.zoneId : resolveZone(this.zoneId, s.x, s.z);
    if (!this.connection && zoneId !== this.zoneId) {
      this.zoneId = zoneId;
      this.events.emit("zoneChanged", zoneId);
    }
    this.ui.set({
      fps: fps || this.ui.get().fps,
      x: Math.round(s.x),
      z: Math.round(s.z),
      zoneId,
      seated: this.local.seated,
      playersInView: this.remotes.size + 1,
      nearby: current?.id === nearby?.id ? current : nearby,
    });
  }

  private updateChunks(): void {
    const p = this.cameraObject?.position ?? this.focus;
    const levels: Record<string, ChunkLevel> = {};
    let changed = false;
    const prev = this.chunks.get().levels;
    for (const chunk of getCityLayout().chunks) {
      const d = distanceToRect(chunk.rect, p.x, p.z);
      // Hysteresis avoids flickering between levels at the boundary.
      const was = prev[chunk.key];
      const highLimit = was === "high" ? CHUNK_HIGH + 15 : CHUNK_HIGH;
      const lowLimit = was === "hidden" ? CHUNK_LOW : CHUNK_LOW + 20;
      const level: ChunkLevel = d < highLimit ? "high" : d < lowLimit ? "low" : "hidden";
      levels[chunk.key] = level;
      if (level !== was) changed = true;
    }
    if (changed) this.chunks.set({ levels });
  }
}
