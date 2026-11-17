import { z } from "zod";
import { callEventSchema } from "./calls";

/**
 * Commands from the API to every game server, over Redis pub/sub (the channel Colyseus' Redis
 * presence uses, so rooms receive them through `presence.subscribe`). Payloads are JSON.
 */
export const USER_CONTROL_CHANNEL = "ew:user-control";

export const userControlSchema = z.discriminatedUnion("type", [
  /** Disconnect every game session of the user (sign-out, world leave, suspension). */
  z.object({ type: z.literal("disconnect"), userId: z.uuid(), reason: z.enum(["signed_out", "left", "suspended"]) }),
  /** The user changed their avatar outside the game; rooms should reload it. */
  z.object({ type: z.literal("avatar_changed"), userId: z.uuid() }),
  /** A voice call event for the user (delivered to their game session as `ServerMessage.CallEvent`). */
  z.object({ type: z.literal("call"), userId: z.uuid(), event: callEventSchema }),
]);
export type UserControl = z.infer<typeof userControlSchema>;

/**
 * Online presence written by game servers: `ew:online:<userId>` holds the zone id while the
 * player is connected, refreshed periodically with a TTL so crashed servers don't leave ghosts.
 */
export const onlineKey = (userId: string) => `ew:online:${userId}`;
export const ONLINE_TTL_SECONDS = 60;

/**
 * Shopkeeper NPC animation updates from the AI agent service. Every game server hosting the
 * agent's shop applies them; the LLM itself never runs inside the game loop.
 */
export const NPC_CONTROL_CHANNEL = "ew:npc-control";

/** What a shopkeeper NPC shows: idle, listening to a customer at the counter, thinking, or talking. */
export const NPC_STATES = ["idle", "listening", "thinking", "talking"] as const;
export type NpcAnimState = (typeof NPC_STATES)[number];

export const npcControlSchema = z.object({
  type: z.literal("npc_state"),
  agentId: z.uuid(),
  conversationId: z.uuid(),
  /** "idle" ends the conversation's turn. */
  state: z.enum(["thinking", "talking", "idle"]),
});
export type NpcControl = z.infer<typeof npcControlSchema>;
