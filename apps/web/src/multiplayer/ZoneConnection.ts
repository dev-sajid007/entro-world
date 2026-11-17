import { Callbacks, Client, type Room } from "@colyseus/sdk";
import type { ZoneId } from "@entroworld/shared";
import {
  callEventSchema,
  ClientMessage,
  ServerMessage,
  ZONE_ROOM,
  type CallEvent,
  type ChatBroadcast,
  type ChatChannel,
  type ErrorPayload,
  type InputFrame,
  type NpcStateShape,
  type ObjectStateShape,
  type PlayerStateShape,
  type ShopPresencePayload,
  type SystemPayload,
  type VoicePeersPayload,
  type VoiceTokenPayload,
  type WelcomePayload,
  type ZoneTransferPayload,
} from "@entroworld/game-protocol";
import type { EmoteId } from "@entroworld/avatar";
import { Emitter } from "../game/core/Emitter";

export type ConnectionStatus = "offline" | "connecting" | "connected" | "reconnecting" | "transferring" | "disconnected";

export interface ZoneEvents extends Record<string, unknown> {
  status: ConnectionStatus;
  playerAdd: { sessionId: string; player: PlayerStateShape };
  playerChange: { sessionId: string; player: PlayerStateShape };
  playerRemove: { sessionId: string };
  objectChange: { id: string; object: ObjectStateShape };
  npcChange: { id: string; npc: NpcStateShape };
  npcRemove: { id: string };
  shopEnter: ShopPresencePayload;
  shopLeave: ShopPresencePayload;
  welcome: WelcomePayload;
  chat: ChatBroadcast;
  chatHistory: ChatBroadcast[];
  system: SystemPayload;
  error: ErrorPayload;
  transfer: ZoneTransferPayload;
  voiceToken: VoiceTokenPayload;
  voicePeers: VoicePeersPayload;
  callEvent: CallEvent;
  propertyChanged: { plotId: string };
  eventUpdate: { eventId: string };
  /** Final leave (after reconnection attempts are exhausted or a consented leave). */
  left: { code: number; consented: boolean };
  latency: number;
}

/**
 * One connection to a zone room on the game server. Wraps the Colyseus client: joins with the
 * short-lived ticket from the API, decodes state through reflection and re-emits typed events.
 */
export class ZoneConnection extends Emitter<ZoneEvents> {
  private leaving = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private constructor(
    readonly room: Room,
    readonly zoneId: ZoneId,
  ) {
    super();
  }

  get sessionId(): string {
    return this.room.sessionId;
  }

  static async connect(endpoint: string, zoneId: ZoneId, ticket: string): Promise<ZoneConnection> {
    const client = new Client(endpoint);
    const room = await client.joinOrCreate(ZONE_ROOM, { zoneId, ticket });
    const connection = new ZoneConnection(room, zoneId);
    connection.bind();
    return connection;
  }

  private bind(): void {
    const room = this.room;
    room.reconnection.maxRetries = 8;
    room.reconnection.maxEnqueuedMessages = 30;
    const cb = Callbacks.get(room as never) as unknown as {
      onAdd: (prop: string, handler: (value: never, key: string) => void) => () => void;
      onRemove: (prop: string, handler: (value: never, key: string) => void) => () => void;
      onChange: (instance: object, handler: () => void) => () => void;
    };

    cb.onAdd("players", (player: PlayerStateShape, sessionId: string) => {
      this.emit("playerAdd", { sessionId, player });
      cb.onChange(player as unknown as object, () => this.emit("playerChange", { sessionId, player }));
    });
    cb.onRemove("players", (_player: PlayerStateShape, sessionId: string) => this.emit("playerRemove", { sessionId }));
    cb.onAdd("objects", (object: ObjectStateShape, id: string) => {
      this.emit("objectChange", { id, object });
      cb.onChange(object as unknown as object, () => this.emit("objectChange", { id, object }));
    });
    cb.onAdd("npcs", (npc: NpcStateShape, id: string) => {
      this.emit("npcChange", { id, npc });
      cb.onChange(npc as unknown as object, () => this.emit("npcChange", { id, npc }));
    });
    cb.onRemove("npcs", (_npc: NpcStateShape, id: string) => this.emit("npcRemove", { id }));

    room.onMessage(ServerMessage.Welcome, (m: WelcomePayload) => this.emit("welcome", m));
    room.onMessage(ServerMessage.Chat, (m: ChatBroadcast) => this.emit("chat", m));
    room.onMessage(ServerMessage.ChatHistory, (m: ChatBroadcast[]) => this.emit("chatHistory", m));
    room.onMessage(ServerMessage.System, (m: SystemPayload) => this.emit("system", m));
    room.onMessage(ServerMessage.Error, (m: ErrorPayload) => this.emit("error", m));
    room.onMessage(ServerMessage.ZoneTransfer, (m: ZoneTransferPayload) => this.emit("transfer", m));
    room.onMessage(ServerMessage.VoiceToken, (m: VoiceTokenPayload) => this.emit("voiceToken", m));
    room.onMessage(ServerMessage.VoicePeers, (m: VoicePeersPayload) => this.emit("voicePeers", m));
    room.onMessage(ServerMessage.CallEvent, (m: unknown) => {
      const parsed = callEventSchema.safeParse(m);
      if (parsed.success) this.emit("callEvent", parsed.data);
    });
    room.onMessage(ServerMessage.PropertyChanged, (m: { plotId: string }) => this.emit("propertyChanged", m));
    room.onMessage(ServerMessage.EventUpdate, (m: { eventId: string }) => this.emit("eventUpdate", m));
    room.onMessage(ServerMessage.ShopEnter, (m: ShopPresencePayload) => this.emit("shopEnter", m));
    room.onMessage(ServerMessage.ShopLeave, (m: ShopPresencePayload) => this.emit("shopLeave", m));
    room.onMessage(ServerMessage.Pong, (m: { t: number }) => this.emit("latency", performance.now() - m.t));

    room.onDrop(() => this.emit("status", "reconnecting"));
    room.onReconnect(() => this.emit("status", "connected"));
    room.onLeave((code: number) => {
      this.stopPing();
      this.emit("left", { code, consented: this.leaving });
    });
    room.onError((code: number, message?: string) => this.emit("error", { code: String(code), message: message ?? "Room error" }));

    this.pingTimer = setInterval(() => this.ping(), 3000);
  }

  private ping(): void {
    this.send(ClientMessage.Ping, { t: performance.now() });
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private send(type: string, payload: unknown): void {
    try {
      (this.room.send as (t: string, p: unknown) => void)(type, payload);
    } catch {
      // Connection closed; the reconnection logic will take over.
    }
  }

  sendInputs(frames: InputFrame[]): void {
    if (frames.length > 0) this.send(ClientMessage.Input, { frames });
  }

  chat(channel: ChatChannel, text: string): void {
    this.send(ClientMessage.Chat, { channel, text });
  }

  emote(emote: EmoteId): void {
    this.send(ClientMessage.Emote, { emote });
  }

  interact(objectId: string): void {
    this.send(ClientMessage.Interact, { objectId });
  }

  stand(): void {
    this.send(ClientMessage.Stand, {});
  }

  travel(kioskId: string, zoneId: ZoneId): void {
    this.send(ClientMessage.Travel, { kioskId, zoneId });
  }

  refreshAvatar(): void {
    this.send(ClientMessage.AvatarRefresh, {});
  }

  requestVoice(): void {
    this.send(ClientMessage.VoiceJoin, {});
  }

  voiceState(muted: boolean, speaking?: boolean): void {
    this.send(ClientMessage.VoiceState, speaking === undefined ? { muted } : { muted, speaking });
  }

  async leave(): Promise<void> {
    this.leaving = true;
    this.stopPing();
    try {
      await this.room.leave(true);
    } catch {
      // Already closed.
    }
    this.clear();
  }
}
