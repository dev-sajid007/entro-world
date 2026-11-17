import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import {
  GAME_TICKET_AUDIENCE,
  GAME_TICKET_ISSUER,
  GAME_TICKET_TTL_SECONDS,
  gameTicketClaimsSchema,
  type GameTicketClaims,
} from "@entroworld/game-protocol";

export class TicketError extends Error {
  constructor(
    readonly code: "ticket_missing" | "ticket_invalid" | "ticket_expired" | "ticket_reused",
    message: string,
  ) {
    super(message);
  }
}

/** Issuer used for tickets the game server signs itself (zone transfers, dev guests). */
export const GAME_SERVER_ISSUER = "entroworld:game";

/**
 * Short-lived, single-use room connection tickets (HS256 JWTs shared with the API).
 * The API issues them on `POST /worlds/join`; the game server issues them for zone transfers.
 */
export class TicketService {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(claims: Omit<GameTicketClaims, "jti">, issuer: string = GAME_SERVER_ISSUER): Promise<{ ticket: string; expiresAt: Date }> {
    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + GAME_TICKET_TTL_SECONDS * 1000);
    const { sub, ...rest } = claims;
    const ticket = await new SignJWT({ ...rest })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(sub)
      .setJti(jti)
      .setIssuer(issuer)
      .setAudience(GAME_TICKET_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { ticket, expiresAt };
  }

  /** Verifies signature, audience, issuer and expiry, and validates the claim shape. */
  async verify(ticket: unknown): Promise<GameTicketClaims> {
    if (typeof ticket !== "string" || ticket.length === 0 || ticket.length > 4096) {
      throw new TicketError("ticket_missing", "A room ticket is required");
    }
    try {
      const { payload } = await jwtVerify(ticket, this.key, {
        algorithms: ["HS256"],
        audience: GAME_TICKET_AUDIENCE,
        issuer: [GAME_TICKET_ISSUER, GAME_SERVER_ISSUER],
        clockTolerance: 5,
      });
      const parsed = gameTicketClaimsSchema.safeParse(payload);
      if (!parsed.success) throw new TicketError("ticket_invalid", "Malformed room ticket");
      return parsed.data;
    } catch (e) {
      if (e instanceof TicketError) throw e;
      if (e instanceof joseErrors.JWTExpired) throw new TicketError("ticket_expired", "Room ticket expired");
      throw new TicketError("ticket_invalid", "Invalid room ticket");
    }
  }
}

/** Atomic "first use wins" check backed by Colyseus presence (Redis in multi-process deployments). */
export interface ReplayGuard {
  /** Returns true the first time `jti` is seen within the ticket lifetime. */
  claim(jti: string): Promise<boolean>;
}

export function presenceReplayGuard(presence: {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): unknown;
}): ReplayGuard {
  return {
    async claim(jti) {
      const key = `ew:ticket:${jti}`;
      const count = await presence.incr(key);
      if (count === 1) await presence.expire(key, GAME_TICKET_TTL_SECONDS + 30);
      return count === 1;
    },
  };
}
