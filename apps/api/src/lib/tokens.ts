import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, errors as joseErrors, jwtVerify } from "jose";
import { GAME_TICKET_AUDIENCE, GAME_TICKET_ISSUER, GAME_TICKET_TTL_SECONDS, type GameTicketClaims } from "@entroworld/game-protocol";
import { ACADEMY_TICKET_AUDIENCE, type AcademyTicketClaims } from "@entroworld/robot-api";
import type { UserRole } from "@entroworld/shared";

export const ACCESS_TOKEN_ISSUER = "entroworld:api";
export const ACCESS_TOKEN_AUDIENCE = "entroworld:web";

export interface AccessClaims {
  userId: string;
  /** Session family id; revoking the family invalidates the access token too. */
  sessionId: string;
  role: UserRole;
}

export class TokenError extends Error {
  constructor(readonly code: "token_expired" | "invalid_token") {
    super(code);
  }
}

/** Short-lived stateless access tokens (HS256). */
export class AccessTokens {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    readonly ttlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(claims: AccessClaims): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);
    const token = await new SignJWT({ sid: claims.sessionId, role: claims.role })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(claims.userId)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { token, expiresAt };
  }

  async verify(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ["HS256"], issuer: ACCESS_TOKEN_ISSUER, audience: ACCESS_TOKEN_AUDIENCE });
      const role = payload.role;
      if (typeof payload.sub !== "string" || typeof payload.sid !== "string" || (role !== "user" && role !== "moderator" && role !== "admin")) {
        throw new TokenError("invalid_token");
      }
      return { userId: payload.sub, sessionId: payload.sid, role };
    } catch (e) {
      if (e instanceof TokenError) throw e;
      if (e instanceof joseErrors.JWTExpired) throw new TokenError("token_expired");
      throw new TokenError("invalid_token");
    }
  }
}

/** Single-use room connection tickets for the game server (same format it verifies). */
export class GameTickets {
  private readonly key: Uint8Array;

  constructor(secret: string) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(claims: Omit<GameTicketClaims, "jti">): Promise<{ ticket: string; expiresAt: Date }> {
    return this.signFor(GAME_TICKET_AUDIENCE, claims);
  }

  /** A ticket for an Academy session room (pair programming, coding battle). */
  async signAcademy(claims: Omit<AcademyTicketClaims, "jti">): Promise<{ ticket: string; expiresAt: Date }> {
    return this.signFor(ACADEMY_TICKET_AUDIENCE, claims);
  }

  private async signFor(audience: string, claims: { sub: string } & Record<string, unknown>): Promise<{ ticket: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + GAME_TICKET_TTL_SECONDS * 1000);
    const { sub, ...rest } = claims;
    const ticket = await new SignJWT({ ...rest })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(sub)
      .setJti(randomUUID())
      .setIssuer(GAME_TICKET_ISSUER)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key);
    return { ticket, expiresAt };
  }
}

/** Opaque random token (refresh tokens, email links). Only its hash is stored. */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
