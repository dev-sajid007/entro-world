import type { FastifyInstance } from "fastify";
import {
  idParamSchema,
  pageQuerySchema,
  reportSchema,
  updateAvatarSchema,
  updateMeSchema,
  userSearchSchema,
  usernameParamSchema,
  uuidSchema,
} from "@entroworld/validation";
import { parse } from "../../lib/errors";
import { requireAuth, viewer } from "../../plugins/auth";
import { PostsService } from "../posts/service";
import { UsersService } from "./service";

export async function userRoutes(app: FastifyInstance): Promise<void> {
  const users = new UsersService(app.ctx);
  const posts = new PostsService(app.ctx);
  app.addHook("preHandler", requireAuth);

  app.patch("/me", async (request) => users.updateMe(viewer(request).userId, parse(updateMeSchema, request.body)));

  app.get("/me/avatar", async (request) => users.avatar(viewer(request).userId));

  app.put("/me/avatar", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) => {
    const userId = viewer(request).userId;
    const avatar = await users.setAvatar(userId, parse(updateAvatarSchema, request.body));
    // Players already in the world see the change without rejoining.
    await app.ctx.presence.control({ type: "avatar_changed", userId }).catch((e) => request.log.warn({ err: e }, "avatar broadcast failed"));
    return avatar;
  });

  app.get("/me/blocked", async (request) => users.blocked(viewer(request).userId));

  app.get("/search", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) => {
    const { q, limit } = parse(userSearchSchema, request.query);
    return users.search(viewer(request).userId, q, limit);
  });

  app.get("/:id/profile", async (request) => users.profile(viewer(request).userId, parse(idParamSchema, request.params).id));

  /** Profile by username (or id, so links can use either). */
  app.get("/:username", async (request) => {
    const { username } = parse(usernameParamSchema, request.params);
    const id = uuidSchema.safeParse(username).success ? username : await users.findIdByUsername(username);
    return users.profile(viewer(request).userId, id);
  });

  app.get("/:id/friends", async (request) => users.friendsOf(viewer(request).userId, parse(idParamSchema, request.params).id));

  app.get("/:id/posts", async (request) => {
    const { id } = parse(idParamSchema, request.params);
    return posts.userPosts(viewer(request).userId, id, parse(pageQuerySchema, request.query));
  });

  app.post("/:id/follow", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request, reply) => {
    await users.follow(viewer(request).userId, parse(idParamSchema, request.params).id);
    return reply.status(204).send();
  });

  app.delete("/:id/follow", async (request, reply) => {
    await users.unfollow(viewer(request).userId, parse(idParamSchema, request.params).id);
    return reply.status(204).send();
  });

  app.post("/:id/block", async (request, reply) => {
    await users.block(viewer(request).userId, parse(idParamSchema, request.params).id);
    return reply.status(204).send();
  });

  app.delete("/:id/block", async (request, reply) => {
    await users.unblock(viewer(request).userId, parse(idParamSchema, request.params).id);
    return reply.status(204).send();
  });

  app.post("/:id/report", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request, reply) => {
    const { id } = parse(idParamSchema, request.params);
    const input = parse(reportSchema, request.body);
    const me = viewer(request).userId;
    await users.profile(me, id); // 404 for unknown/hidden accounts
    await users.report(me, { type: "user", userId: id, contentId: null }, input);
    return reply.status(202).send();
  });
}
