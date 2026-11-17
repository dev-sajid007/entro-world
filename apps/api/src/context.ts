import type { Redis } from "ioredis";
import type { ApiEnv } from "@entroworld/config";
import type { Database } from "@entroworld/database";
import type { AiServiceClient } from "./lib/ai-service";
import type { Mailer } from "./lib/mailer";
import type { PresenceReader } from "./lib/presence";
import type { AccessClaims, AccessTokens, GameTickets } from "./lib/tokens";

/** External resources the API needs; tests supply their own. */
export interface AppDeps {
  env: ApiEnv;
  db: Database;
  redis: Redis;
  mailer: Mailer;
}

export interface AppContext extends AppDeps {
  accessTokens: AccessTokens;
  gameTickets: GameTickets;
  presence: PresenceReader;
  ai: AiServiceClient;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
  interface FastifyRequest {
    /** Verified access-token claims, or null for anonymous requests. */
    auth: AccessClaims | null;
    /** Why a presented token was rejected (reported by `requireAuth`). */
    authError: "token_expired" | "invalid_token" | "session_revoked" | null;
  }
}
