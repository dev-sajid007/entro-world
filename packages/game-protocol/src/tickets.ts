import { z } from "zod";
import { ZONE_IDS } from "@entroworld/shared";

/** Claims carried by the short-lived room connection ticket issued by the API. */
export const gameTicketClaimsSchema = z.object({
  sub: z.string().uuid(),
  username: z.string(),
  displayName: z.string(),
  zoneId: z.enum(ZONE_IDS),
  spawn: z.object({ x: z.number().finite(), y: z.number().finite(), z: z.number().finite(), rotation: z.number().finite() }),
  jti: z.string().min(8),
  /** Development guest without an account: nothing about them is persisted. */
  guest: z.boolean().optional(),
});
export type GameTicketClaims = z.infer<typeof gameTicketClaimsSchema>;

export const GAME_TICKET_AUDIENCE = "entroworld:game";
export const GAME_TICKET_ISSUER = "entroworld:api";
export const GAME_TICKET_TTL_SECONDS = 60;
