import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { idParamSchema } from "@entroworld/validation";
import { lessonAttemptRequestSchema, saveCodeRequestSchema } from "@entroworld/robot-api";
import { parse } from "../../lib/errors";
import { requireAuth, viewer } from "../../plugins/auth";
import { AcademyService } from "./service";

const slugParamSchema = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,60}$/) }).strict();

/** Coding Academy: tracks, lessons, progress and server-verified puzzle attempts. */
export async function academyRoutes(app: FastifyInstance): Promise<void> {
  const academy = new AcademyService(app.ctx);
  app.addHook("preHandler", requireAuth);

  app.get("/tracks", async () => ({ tracks: await academy.tracks() }));
  app.get("/tracks/:slug", async (request) => ({ track: await academy.track(parse(slugParamSchema, request.params).slug) }));
  app.get("/lessons/:id", async (request) => ({ lesson: await academy.lesson(viewer(request).userId, parse(idParamSchema, request.params).id) }));
  app.get("/progress/me", async (request) => academy.progress(viewer(request).userId));
  app.get("/badges/me", async (request) => ({ badges: await academy.badges(viewer(request).userId) }));

  app.post("/lessons/:id/attempts", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) =>
    academy.attempt(viewer(request).userId, parse(idParamSchema, request.params).id, parse(lessonAttemptRequestSchema, request.body)),
  );

  app.put("/lessons/:id/code", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    await academy.saveCode(viewer(request).userId, parse(idParamSchema, request.params).id, parse(saveCodeRequestSchema, request.body));
    return reply.status(204).send();
  });
}
