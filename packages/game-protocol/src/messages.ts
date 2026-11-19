import { z } from "zod";
import { EMOTES } from "@entroworld/avatar";
import { LIMITS, ZONE_IDS, type ZoneId } from "@entroworld/shared";
import { ALL_BUTTONS } from "./input";

/** Room name registered on the game server. */
export const ZONE_ROOM = "zone";

/** Client -> server message types. */
export const ClientMessage = {
  Input: "input",
  Chat: "chat",
  Emote: "emote",
  Interact: "interact",
  Stand: "stand",
  VoiceJoin: "voice:join",
  VoiceState: "voice:state",
  AvatarRefresh: "avatar:refresh",
  Travel: "travel",
  /** Live classes: take over an Event Center screen, update what it shows, hand it back. */
  ClassStart: "class:start",
  ClassUpdate: "class:update",
  ClassEnd: "class:end",
  Ping: "ping",
} as const;

/** Server -> client message types. */
export const ServerMessage = {
  Welcome: "welcome",
  Chat: "chat",
  ChatHistory: "chat:history",
  System: "system",
  Error: "error",
  ZoneTransfer: "zone:transfer",
  VoiceToken: "voice:token",
  VoicePeers: "voice:peers",
  PropertyChanged: "property:changed",
  EventUpdate: "event:update",
  /** The player walked up to a shop counter (entered its trigger area) or left it. */
  ShopEnter: "shop:enter",
  ShopLeave: "shop:leave",
  /** A 1:1 voice call event (`CallEvent`). */
  CallEvent: "call:event",
  /** A friend invited you to an Academy session (`AcademyInvite`). */
  AcademyInvite: "academy:invite",
  Pong: "pong",
} as const;

/**
 * Application-level WebSocket close codes. 4000-4010 are reserved by Colyseus. Clients must treat
 * these as final and not auto-rejoin.
 */
export const CloseReason = {
  /** The same account joined again (e.g. another tab); the older session is closed. */
  DuplicateSession: 4101,
  /** Removed for protocol abuse (invalid or flooding messages). */
  Kicked: 4102,
  /** The account signed out, left the world from another device, or was suspended. */
  SignedOut: 4103,
} as const;

export const isFinalCloseCode = (code: number): boolean =>
  code === CloseReason.DuplicateSession || code === CloseReason.Kicked || code === CloseReason.SignedOut;

export const MAX_INPUTS_PER_MESSAGE = 12;

export const inputFrameSchema = z
  .object({
    seq: z.number().int().nonnegative().max(2 ** 31),
    buttons: z.number().int().min(0).max(ALL_BUTTONS),
    yaw: z.number().finite().min(-1000).max(1000),
  })
  .strict();

export const inputMessageSchema = z.object({ frames: z.array(inputFrameSchema).min(1).max(MAX_INPUTS_PER_MESSAGE) }).strict();
export type InputMessage = z.infer<typeof inputMessageSchema>;

export const CHAT_CHANNELS = ["room", "zone", "global"] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

export const chatMessageSchema = z
  .object({
    channel: z.enum(CHAT_CHANNELS),
    text: z.string().trim().min(1).max(LIMITS.chatMessage.max),
  })
  .strict();
export type ChatMessageInput = z.infer<typeof chatMessageSchema>;

export const emoteMessageSchema = z.object({ emote: z.enum(EMOTES) }).strict();
export const interactMessageSchema = z.object({ objectId: z.string().min(1).max(80) }).strict();
export const travelMessageSchema = z.object({ kioskId: z.string().min(1).max(80), zoneId: z.enum(ZONE_IDS) }).strict();
export const voiceStateSchema = z.object({ speaking: z.boolean().optional(), muted: z.boolean() }).strict();
export const pingSchema = z.object({ t: z.number().finite() }).strict();

export interface ChatSender {
  userId: string;
  username: string;
  displayName: string;
  sessionId: string;
}

export interface ChatBroadcast {
  id: string;
  channel: ChatChannel;
  from: ChatSender;
  text: string;
  zoneId: ZoneId;
  ts: number;
}

export interface WelcomePayload {
  sessionId: string;
  roomId: string;
  zoneId: ZoneId;
  serverTime: number;
  voiceAvailable: boolean;
  tickRate: number;
}

export interface ZoneTransferPayload {
  zoneId: ZoneId;
  ticket: string;
  position: { x: number; y: number; z: number; rotation: number };
  reason: "border" | "travel";
}

export interface VoiceTokenPayload {
  url: string;
  token: string;
  room: string;
  identity: string;
}

export interface VoicePeer {
  userId: string;
  /** 0..1 volume derived from authoritative distance. */
  gain: number;
}

export interface VoicePeersPayload {
  peers: VoicePeer[];
}

export interface ShopPresencePayload {
  shopSlug: string;
  agentId: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface SystemPayload {
  text: string;
}

// -------------------------------------------------------------------------------------------------
// Live classes (SPEC-ADDENDUM-01 §3.3): a presenter shows their program on an Event Center screen.
// The screen's ObjectState holds the presenter's session id in `occupant` and a JSON-encoded
// `ClassScreenContent` in `value` ("" while the screen is free).
// -------------------------------------------------------------------------------------------------

export const CLASS_TITLE_MAX = 80;
export const CLASS_CODE_MAX = 4000;
export const CLASS_STATUS_MAX = 160;

export const classStartSchema = z.object({ screenId: z.string().min(1).max(80), title: z.string().trim().min(1).max(CLASS_TITLE_MAX) }).strict();
export const classUpdateSchema = z
  .object({
    code: z.string().max(CLASS_CODE_MAX),
    /** One line under the code, e.g. the last run's result. */
    status: z.string().max(CLASS_STATUS_MAX),
  })
  .strict();

export interface ClassScreenContent {
  presenterId: string;
  presenterName: string;
  title: string;
  code: string;
  status: string;
  startedAt: number;
}

export function parseClassScreen(value: string): ClassScreenContent | null {
  if (!value) return null;
  try {
    const v = JSON.parse(value) as Partial<ClassScreenContent>;
    if (typeof v.presenterId !== "string" || typeof v.title !== "string" || typeof v.code !== "string") return null;
    return {
      presenterId: v.presenterId,
      presenterName: typeof v.presenterName === "string" ? v.presenterName : "",
      title: v.title,
      code: v.code,
      status: typeof v.status === "string" ? v.status : "",
      startedAt: typeof v.startedAt === "number" ? v.startedAt : 0,
    };
  } catch {
    return null;
  }
}
