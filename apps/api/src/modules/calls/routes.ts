import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { idParamSchema } from "@entroworld/validation";
import { parse } from "../../lib/errors";
import { requireAuth, viewer } from "../../plugins/auth";
import { CallService } from "./service";

const startSchema = z.object({ calleeId: z.uuid() }).strict();
const endSchema = z.object({ reason: z.enum(["missed"]).optional() }).strict();

/** 1:1 voice calls between friends (signalling only; audio flows through LiveKit). */
export async function callRoutes(app: FastifyInstance): Promise<void> {
  const calls = new CallService(app.ctx);
  app.addHook("preHandler", requireAuth);

  app.get("/current", async (request) => ({ call: await calls.current(viewer(request).userId) }));

  app.post("/", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const call = await calls.start(viewer(request).userId, parse(startSchema, request.body).calleeId);
    return reply.status(201).send({ call });
  });

  app.post("/:id/accept", async (request) => calls.accept(viewer(request).userId, parse(idParamSchema, request.params).id));
  app.post("/:id/join", async (request) => calls.join(viewer(request).userId, parse(idParamSchema, request.params).id));

  app.post("/:id/end", async (request, reply) => {
    const { reason } = parse(endSchema, request.body);
    await calls.end(viewer(request).userId, parse(idParamSchema, request.params).id, reason === "missed");
    return reply.status(204).send();
  });
}
