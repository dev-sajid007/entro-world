import type { FastifyInstance } from "fastify";
import { friendRequestSchema, idParamSchema } from "@entroworld/validation";
import { parse } from "../../lib/errors";
import { requireAuth, viewer } from "../../plugins/auth";
import { UsersService } from "../users/service";
import { FriendsService } from "./service";

export async function friendRoutes(app: FastifyInstance): Promise<void> {
  const friends = new FriendsService(app.ctx);
  const users = new UsersService(app.ctx);
  app.addHook("preHandler", requireAuth);

  /** The caller's own friends, with online status and zone. */
  app.get("/", async (request) => {
    const me = viewer(request).userId;
    return users.friendsOf(me, me);
  });

  app.get("/requests", async (request) => {
    const me = viewer(request).userId;
    const [incoming, outgoing] = await Promise.all([friends.requests(me, "incoming"), friends.requests(me, "outgoing")]);
    return { incoming, outgoing };
  });

  app.post("/requests", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request, reply) => {
    const result = await friends.request(viewer(request).userId, parse(friendRequestSchema, request.body).userId);
    return reply.status(result.status === "friends" ? 200 : 201).send(result);
  });

  app.post("/requests/:id/accept", async (request, reply) => {
    await friends.accept(viewer(request).userId, parse(idParamSchema, request.params).id);
    return reply.status(204).send();
  });

  app.post("/requests/:id/reject", async (request, reply) => {
    await friends.decline(viewer(request).userId, parse(idParamSchema, request.params).id);
    return reply.status(204).send();
  });

  app.delete("/requests/:id", async (request, reply) => {
    await friends.decline(viewer(request).userId, parse(idParamSchema, request.params).id);
    return reply.status(204).send();
  });

  app.delete("/:id", async (request, reply) => {
    await friends.remove(viewer(request).userId, parse(idParamSchema, request.params).id);
    return reply.status(204).send();
  });
}
