import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { idParamSchema } from "@entroworld/validation";
import { createSessionRequestSchema, leaderboardQuerySchema, lessonAttemptRequestSchema, saveCodeRequestSchema } from "@entroworld/robot-api";
import { parse } from "../../lib/errors";
import { requireAuth, viewer } from "../../plugins/auth";
import { AcademyService } from "./service";
import { AcademySessionService } from "./sessions";

const slugParamSchema = z.object({ slug: z.string().regex(/^[a-z0-9-]{1,60}$/) }).strict();

/** Coding Academy: tracks, lessons, progress and server-verified puzzle attempts. */
export async function academyRoutes(app: FastifyInstance): Promise<void> {
  const academy = new AcademyService(app.ctx);
  const sessions = new AcademySessionService(app.ctx);
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

  app.get("/leaderboard", async (request) => academy.leaderboard(viewer(request).userId, parse(leaderboardQuerySchema, request.query).scope));

  // Pair programming and coding battles with a friend.
  app.post("/sessions", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const result = await sessions.create(viewer(request).userId, parse(createSessionRequestSchema, request.body));
    return reply.status(201).send(result);
  });
  app.get("/sessions/invites", async (request) => ({ invites: await sessions.invites(viewer(request).userId) }));
  app.post("/sessions/:id/join", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) =>
    sessions.join(viewer(request).userId, parse(idParamSchema, request.params).id),
  );
  app.delete("/sessions/:id", async (request, reply) => {
    await sessions.leave(viewer(request).userId, parse(idParamSchema, request.params).id);
    return reply.status(204).send();
  });
}
