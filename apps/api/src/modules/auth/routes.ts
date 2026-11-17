import type { FastifyInstance } from "fastify";
import { loginSchema, registerSchema, resendVerificationSchema, uuidSchema, verifyEmailSchema } from "@entroworld/validation";
import { notFound, parse } from "../../lib/errors";
import { requireAuth, viewer } from "../../plugins/auth";
import { AuthService, loadCurrentUser } from "./service";

export async function authRoutes(app: FastifyInstance): Promise<void> {
  const auth = new AuthService(app.ctx);

  app.post("/register", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request, reply) => {
    const result = await auth.register(parse(registerSchema, request.body), request, reply);
    return reply.status(201).send(result);
  });

  app.post("/login", { config: { rateLimit: { max: 30, timeWindow: "15 minutes" } } }, async (request, reply) => {
    return auth.login(parse(loginSchema, request.body), request, reply);
  });

  app.post("/refresh", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    return auth.refresh(request, reply);
  });

  app.post("/logout", async (request, reply) => {
    await auth.logout(request, reply);
    return reply.status(204).send();
  });

  app.get("/me", { preHandler: requireAuth }, async (request) => {
    const user = await loadCurrentUser(app.ctx.db, viewer(request).userId);
    if (!user) throw notFound("User");
    return user;
  });

  app.get("/sessions", { preHandler: requireAuth }, async (request) => {
    const me = viewer(request);
    return auth.listSessions(me.userId, me.sessionId);
  });

  app.delete("/sessions/:id", { preHandler: requireAuth }, async (request, reply) => {
    const id = parse(uuidSchema, (request.params as { id?: unknown }).id);
    await auth.revokeSession(viewer(request).userId, id);
    return reply.status(204).send();
  });

  app.post("/verify-email", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (request, reply) => {
    await auth.verifyEmail(parse(verifyEmailSchema, request.body).token);
    return reply.status(204).send();
  });

  app.post("/resend-verification", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (request, reply) => {
    await auth.resendVerification(parse(resendVerificationSchema, request.body).email);
    return reply.status(202).send();
  });
}
