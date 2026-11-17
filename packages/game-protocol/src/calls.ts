import { z } from "zod";

/**
 * 1:1 voice calls between friends. The API owns call state (in Redis) and issues LiveKit tokens;
 * call events reach the other person through the game server they are connected to (published on
 * the user-control channel, delivered as `ServerMessage.CallEvent`). Audio never touches either.
 */

/** How long an unanswered call rings before the caller gives up. */
export const CALL_RING_SECONDS = 30;

export const callPartySchema = z.object({
  id: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
export type CallParty = z.infer<typeof callPartySchema>;

export const callViewSchema = z.object({
  id: z.uuid(),
  caller: callPartySchema,
  callee: callPartySchema,
  status: z.enum(["ringing", "active"]),
  createdAt: z.string(),
});
export type CallView = z.infer<typeof callViewSchema>;

export const CALL_END_REASONS = ["hangup", "cancelled", "declined", "missed", "busy", "failed"] as const;
export type CallEndReason = (typeof CALL_END_REASONS)[number];

export const callEventSchema = z.discriminatedUnion("kind", [
  /** A friend is calling you. */
  z.object({ kind: z.literal("incoming"), call: callViewSchema }),
  /** The person you called picked up: fetch your token and connect. */
  z.object({ kind: z.literal("accepted"), callId: z.uuid() }),
  /** The call is over (the other side hung up, declined, cancelled or never answered). */
  z.object({ kind: z.literal("ended"), callId: z.uuid(), reason: z.enum(CALL_END_REASONS) }),
]);
export type CallEvent = z.infer<typeof callEventSchema>;

export interface CallVoiceToken {
  url: string;
  token: string;
  room: string;
}

export interface CallJoinResponse {
  call: CallView;
  voice: CallVoiceToken;
}
