import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { agentMessageRequestSchema } from "@entroworld/agent-protocol";
import { idParamSchema, pageQuerySchema, reportSchema } from "@entroworld/validation";
import { AppError, conflict, notFound, parse } from "../../lib/errors";
import { requireAuth, viewer } from "../../plugins/auth";
import { MarketService } from "./service";

const slugParamSchema = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,40}$/) });
const conversationsQuerySchema = pageQuerySchema.extend({ agentId: z.uuid().optional() });

const aiUnavailable = () => new AppError(503, "ai_unavailable", "The shopkeepers are unavailable right now. Please try again soon.");

/** AI Agent Street (SPEC-ADDENDUM-01 §12). Every endpoint requires a signed-in user. */
export async function marketRoutes(app: FastifyInstance): Promise<void> {
  const market = new MarketService(app.ctx);
  app.addHook("preHandler", requireAuth);

  app.get("/shops", async () => market.shops());
  app.get("/shops/:slug", async (request) => market.shop(parse(slugParamSchema, request.params).slug));
  app.get("/shops/:slug/products", async (request) => market.products(parse(slugParamSchema, request.params).slug));
  app.get("/agents/:id", async (request) => market.agent(parse(idParamSchema, request.params).id));

  app.post("/agents/:id/conversations", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const conversation = await market.createConversation(viewer(request).userId, parse(idParamSchema, request.params).id);
    return reply.status(201).send(conversation);
  });

  app.get("/conversations", async (request) => market.conversations(viewer(request).userId, parse(conversationsQuerySchema, request.query)));

  app.get("/conversations/:id/messages", async (request) =>
    market.messages(viewer(request).userId, parse(idParamSchema, request.params).id, parse(pageQuerySchema, request.query)),
  );

  app.delete("/conversations/:id", async (request, reply) => {
    await market.deleteConversation(viewer(request).userId, parse(idParamSchema, request.params).id);
    return reply.status(204).send();
  });

  /**
   * Sends a message and streams the agent's answer back as Server-Sent Events (relayed from the
   * AI agent service). Errors that happen before streaming starts are normal JSON errors.
   */
  app.post("/conversations/:id/messages", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const userId = viewer(request).userId;
    const { id } = parse(idParamSchema, request.params);
    const body = parse(agentMessageRequestSchema, request.body);
    await market.requireConversation(userId, id);

    const controller = new AbortController();
    let upstream: Response;
    try {
      upstream = await app.ctx.ai.sendMessage(id, { userId, ...body }, controller.signal);
    } catch (err) {
      request.log.warn({ err }, "AI agent service unreachable");
      throw aiUnavailable();
    }
    if (!upstream.headers.get("content-type")?.startsWith("text/event-stream") || !upstream.body) {
      const data = (await upstream.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
      if (upstream.status === 404) throw notFound("Conversation");
      if (upstream.status === 409) throw conflict(data?.error?.message ?? "Still answering your last message.", data?.error?.code ?? "conversation_busy");
      request.log.error({ status: upstream.status, code: data?.error?.code }, "AI agent service rejected a request");
      throw aiUnavailable();
    }
    // The visitor leaving stops the answer (and the model) upstream.
    reply.raw.on("close", () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    return reply
      .header("content-type", "text/event-stream; charset=utf-8")
      .header("x-accel-buffering", "no")
      .send(Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>));
  });

  app.get("/usage/me", async (request) => {
    try {
      return await app.ctx.ai.usage(viewer(request).userId);
    } catch (err) {
      request.log.warn({ err }, "could not load AI usage");
      throw aiUnavailable();
    }
  });

  app.post("/messages/:id/report", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (request, reply) => {
    await market.reportMessage(viewer(request).userId, parse(idParamSchema, request.params).id, parse(reportSchema, request.body));
    return reply.status(204).send();
  });
}
