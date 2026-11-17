import { timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import type { Redis } from "ioredis";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { INTERNAL_TOKEN_HEADER, encodeSse, internalAgentMessageSchema, type AgentStreamEvent } from "@entroworld/agent-protocol";
import { internalServiceToken, type AiEnv } from "@entroworld/config";
import type { Database } from "@entroworld/database";
import { AgentRegistry } from "./agents/registry";
import { Responder } from "./conversations/responder";
import { ConversationStore } from "./conversations/store";
import { NpcPublisher } from "./npc/publisher";
import type { LlmProvider } from "./providers/types";
import { QuotaService } from "./usage/quota";

export interface AiAppDeps {
  env: AiEnv;
  db: Database;
  redis: Redis;
  provider: LlmProvider;
}

export interface AiAppOptions {
  logger?: boolean | object;
  /** SSE keep-alive comment interval (tests shorten it). */
  keepAliveMs?: number;
}

/** Upper bound for one answer, including thinking time. */
const DEFAULT_MAX_TOKENS = 4096;

const idParams = z.object({ id: z.uuid() });
const userParams = z.object({ userId: z.uuid() });

/**
 * The AI agent service (SPEC-ADDENDUM-01 §10). It is internal: only the API calls it, with a
 * shared secret, after authenticating the user. It never runs inside the game loop.
 */
export async function buildAiApp(deps: AiAppDeps, options: AiAppOptions = {}): Promise<FastifyInstance> {
  const { env, db, redis, provider } = deps;
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 64 * 1024 });
  const token = Buffer.from(internalServiceToken(env));
  const keepAliveMs = options.keepAliveMs ?? 15_000;

  const registry = new AgentRegistry(db);
  const quota = new QuotaService(redis, db, { requests: env.AI_USER_DAILY_REQUEST_LIMIT, tokens: env.AI_USER_DAILY_TOKEN_LIMIT });
  const responder = new Responder({
    store: new ConversationStore(db, redis),
    registry,
    provider,
    quota,
    npc: new NpcPublisher(redis),
    moderationEnabled: env.AI_MODERATION_ENABLED,
    canarySecret: token.toString(),
    defaults: { model: env.AI_DEFAULT_MODEL, effort: env.AI_DEFAULT_EFFORT, maxTokens: DEFAULT_MAX_TOKENS },
    log: {
      info: (obj, msg) => app.log.info(obj, msg),
      warn: (obj, msg) => app.log.warn(obj, msg),
      error: (obj, msg) => app.log.error(obj, msg),
    },
  });

  const authorized = (request: FastifyRequest): boolean => {
    const presented = request.headers[INTERNAL_TOKEN_HEADER];
    if (typeof presented !== "string") return false;
    const value = Buffer.from(presented);
    return value.length === token.length && timingSafeEqual(value, token);
  };

  const fail = (status: number, code: string, message: string) => ({ status, body: { error: { code, message } } });

  app.get("/health", async () => ({ status: "ok", provider: provider.name }));
  app.get("/ready", async (_request, reply) => {
    try {
      await Promise.all([db.execute(sql`select 1`), redis.ping()]);
      return { status: "ready" };
    } catch {
      return reply.status(503).send({ status: "unavailable" });
    }
  });

  app.register(
    async (internal) => {
      internal.addHook("onRequest", async (request, reply) => {
        if (!authorized(request)) {
          const e = fail(401, "unauthorized", "Missing or invalid internal token");
          return reply.status(e.status).send(e.body);
        }
      });

      internal.get("/usage/:userId", async (request, reply) => {
        const params = userParams.safeParse(request.params);
        if (!params.success) return reply.status(400).send(fail(400, "validation_error", "Invalid user id").body);
        return quota.usage(params.data.userId);
      });

      /** Streams the agent's answer to one message as Server-Sent Events. */
      internal.post("/conversations/:id/messages", async (request, reply) => {
        const params = idParams.safeParse(request.params);
        const body = internalAgentMessageSchema.safeParse(request.body);
        if (!params.success || !body.success) return reply.status(400).send(fail(400, "validation_error", "Invalid message").body);

        const prepared = await responder.prepare({ conversationId: params.data.id, ...body.data });
        if (!prepared.ok) return reply.status(prepared.status).send(fail(prepared.status, prepared.code, prepared.message).body);

        reply.hijack();
        const res = reply.raw;
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        });
        res.flushHeaders();
        const controller = new AbortController();
        res.on("close", () => {
          if (!res.writableFinished) controller.abort();
        });
        const keepAlive = setInterval(() => res.write(": keep-alive\n\n"), keepAliveMs);
        const sink = (event: AgentStreamEvent) => {
          if (!res.destroyed) res.write(encodeSse(event));
        };
        try {
          await prepared.turn.run(sink, controller.signal);
        } catch (err) {
          request.log.error({ err }, "agent turn failed");
          sink({ type: "error", code: "unavailable", message: "Something went wrong. Please try again." });
        } finally {
          clearInterval(keepAlive);
          res.end();
        }
      });
    },
    { prefix: "/internal/v1" },
  );

  return app;
}
