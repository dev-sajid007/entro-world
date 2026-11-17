import { z } from "zod";

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
]);
export type UserControl = z.infer<typeof userControlSchema>;

/**
 * Online presence written by game servers: `ew:online:<userId>` holds the zone id while the
 * player is connected, refreshed periodically with a TTL so crashed servers don't leave ghosts.
 */
export const onlineKey = (userId: string) => `ew:online:${userId}`;
export const ONLINE_TTL_SECONDS = 60;
