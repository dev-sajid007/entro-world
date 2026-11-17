import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { sql } from "drizzle-orm";
import type { AppContext, AppDeps } from "./context";
import { AiServiceClient } from "./lib/ai-service";
import { forbidden } from "./lib/errors";
import { PresenceReader } from "./lib/presence";
import { AccessTokens, GameTickets } from "./lib/tokens";
import { authRoutes } from "./modules/auth/routes";
import { callRoutes } from "./modules/calls/routes";
import { academyRoutes } from "./modules/academy/routes";
import { friendRoutes } from "./modules/friends/routes";
import { marketRoutes } from "./modules/market/routes";
import { postRoutes } from "./modules/posts/routes";
import { userRoutes } from "./modules/users/routes";
import { worldRoutes } from "./modules/worlds/routes";
import { setupAuth } from "./plugins/auth";
import { setupErrors } from "./plugins/errors";

export const API_PREFIX = "/api/v1";

export interface BuildOptions {
  logger?: FastifyServerOptions["logger"];
  /** Disable to run many requests from one address (tests). Defaults to on. */
  rateLimit?: boolean;
}

export async function buildApp(deps: AppDeps, options: BuildOptions = {}): Promise<FastifyInstance> {
  const { env } = deps;
  const app = Fastify({
    logger: options.logger ?? { level: env.LOG_LEVEL, redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'] },
    trustProxy: env.TRUST_PROXY,
    bodyLimit: 256 * 1024,
    routerOptions: { maxParamLength: 200 },
  });

  const ctx: AppContext = {
    ...deps,
    accessTokens: new AccessTokens(env.JWT_ACCESS_SECRET, env.ACCESS_TOKEN_TTL_SECONDS),
    gameTickets: new GameTickets(env.GAME_TICKET_SECRET),
    presence: new PresenceReader(deps.redis),
    ai: new AiServiceClient(env),
  };
  app.decorate("ctx", ctx);

  setupErrors(app);
  setupAuth(app);

  const allowedOrigins = new Set([env.APP_URL, ...env.CORS_ORIGINS].map((o) => o.replace(/\/$/, "")));
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)),
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"],
    maxAge: 600,
  });
  await app.register(cookie);

  // Cookie-authenticated endpoints (refresh/logout) only accept requests from our own origins.
  // The cookie is SameSite=Strict as well; this is defense in depth against CSRF.
  app.addHook("onRequest", async (request) => {
    if (request.method !== "POST" || !request.url.startsWith(`${API_PREFIX}/auth/`)) return;
    const origin = request.headers.origin;
    if (origin && !allowedOrigins.has(origin)) throw forbidden("Cross-site request refused", "bad_origin");
  });

  app.addHook("onSend", async (_request, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "no-referrer");
    if (!reply.hasHeader("Cache-Control")) reply.header("Cache-Control", "no-store");
  });

  if (options.rateLimit !== false) {
    await app.register(rateLimit, {
      global: true,
      max: 300,
      timeWindow: "1 minute",
      redis: deps.redis,
      nameSpace: "ew:rl:",
      skipOnError: true,
      // Authenticated callers are limited per account, everyone else per address.
      keyGenerator: (request) => (request.auth ? `u:${request.auth.userId}` : `ip:${request.ip}`),
    });
  }

  app.get("/health", { config: { rateLimit: false } }, async () => ({ status: "ok" }));
  app.get("/ready", { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await Promise.all([ctx.db.execute(sql`select 1`), ctx.redis.ping()]);
      return { status: "ready" };
    } catch {
      return reply.status(503).send({ status: "unavailable" });
    }
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: "/auth" });
      await api.register(userRoutes, { prefix: "/users" });
      await api.register(friendRoutes, { prefix: "/friends" });
      await api.register(postRoutes, { prefix: "/posts" });
      await api.register(worldRoutes, { prefix: "/worlds" });
      await api.register(marketRoutes, { prefix: "/market" });
      await api.register(callRoutes, { prefix: "/calls" });
      await api.register(academyRoutes, { prefix: "/academy" });
    },
    { prefix: API_PREFIX },
  );

  return app;
}
