import type { FastifyInstance, FastifyRequest } from "fastify";
import type { UserRole } from "@entroworld/shared";
import { forbidden, unauthorized } from "../lib/errors";
import { TokenError, type AccessClaims } from "../lib/tokens";

export const revokedSessionKey = (familyId: string) => `ew:revoked-session:${familyId}`;

/**
 * Parses the bearer token on every request (without rejecting), so rate limiting can key by user.
 * Routes opt into authentication with `requireAuth`. Applied to the root instance on purpose: hooks
 * must cover every route.
 */
export function setupAuth(app: FastifyInstance): void {
  app.decorateRequest("auth", null);
  app.decorateRequest("authError", null);

  app.addHook("onRequest", async (request) => {
    const header = request.headers.authorization;
    if (!header) return;
    const match = /^Bearer ([A-Za-z0-9._-]{20,2048})$/.exec(header);
    if (!match) {
      request.authError = "invalid_token";
      return;
    }
    try {
      const claims = await app.ctx.accessTokens.verify(match[1]!);
      if (await app.ctx.redis.exists(revokedSessionKey(claims.sessionId))) {
        request.authError = "session_revoked";
        return;
      }
      request.auth = claims;
    } catch (e) {
      request.authError = e instanceof TokenError ? e.code : "invalid_token";
    }
  });
}

export async function requireAuth(request: FastifyRequest): Promise<void> {
  if (request.auth) return;
  switch (request.authError) {
    case "token_expired":
      throw unauthorized("Your session expired", "token_expired");
    case "session_revoked":
      throw unauthorized("This session was signed out", "session_revoked");
    case "invalid_token":
      throw unauthorized("Invalid access token", "invalid_token");
    default:
      throw unauthorized();
  }
}

export function requireRole(...roles: UserRole[]) {
  return async (request: FastifyRequest): Promise<void> => {
    await requireAuth(request);
    if (!roles.includes(request.auth!.role)) throw forbidden();
  };
}

/** The authenticated caller (only valid in routes guarded by `requireAuth`). */
export function viewer(request: FastifyRequest): AccessClaims {
  if (!request.auth) throw unauthorized();
  return request.auth;
}
