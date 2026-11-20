import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { idParamSchema } from "@entroworld/validation";
import { tutorHintRequestSchema } from "@entroworld/agent-protocol";
import { createSessionRequestSchema, leaderboardQuerySchema, lessonAttemptRequestSchema, saveCodeRequestSchema } from "@entroworld/robot-api";
import { AppError, parse } from "../../lib/errors";
import { relayAiStream } from "../../lib/sse-relay";
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

  /**
   * AI tutor hint for a lesson (SPEC-ADDENDUM-01 §3.3), streamed as Server-Sent Events. The puzzle
   * is described from the database; the learner's code is only included when they shared it.
   */
  app.post("/lessons/:id/tutor", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const userId = viewer(request).userId;
    const { id } = parse(idParamSchema, request.params);
    const body = parse(tutorHintRequestSchema, request.body);
    const lesson = await academy.tutorContext(id);
    const tutorRequest = {
      editorMode: body.editorMode,
      previousHints: body.previousHints,
      ...(body.question ? { question: body.question } : {}),
      ...(body.code !== undefined ? { code: body.code } : {}),
      // Undefined fields (an empty error detail) are dropped when the request is serialized.
      ...(body.lastRun ? { lastRun: body.lastRun } : {}),
    };
    return relayAiStream(
      request,
      reply,
      (signal) => app.ctx.ai.tutorHint({ userId, lesson, request: tutorRequest }, signal),
      () => null,
      () => new AppError(503, "ai_unavailable", "The tutor is unavailable right now. The lesson hints can still help!"),
    );
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
