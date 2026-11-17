import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { idParamSchema, joinWorldSchema, zoneIdSchema } from "@entroworld/validation";
import { parse } from "../../lib/errors";
import { requireAuth, requireRole, viewer } from "../../plugins/auth";
import { WorldsService } from "./service";

const zoneParams = z.object({ id: zoneIdSchema }).strict();

export async function worldRoutes(app: FastifyInstance): Promise<void> {
  const worlds = new WorldsService(app.ctx);

  app.get("/", { preHandler: requireAuth }, async () => worlds.list());
  app.get("/instances", { preHandler: requireRole("moderator", "admin") }, async () => worlds.instances());
  app.get("/zones/:id", { preHandler: requireAuth }, async (request) => worlds.zone(parse(zoneParams, request.params).id));
  app.get("/:id/zones", { preHandler: requireAuth }, async (request) => worlds.zones(parse(idParamSchema, request.params).id));

  app.post("/join", { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) =>
    worlds.join(viewer(request).userId, parse(joinWorldSchema, request.body).zoneId),
  );

  app.post("/leave", { preHandler: requireAuth }, async (request, reply) => {
    await worlds.leave(viewer(request).userId);
    return reply.status(204).send();
  });
}
