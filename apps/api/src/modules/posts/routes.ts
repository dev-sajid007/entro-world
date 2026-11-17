import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createCommentSchema,
  createPostSchema,
  idParamSchema,
  pageQuerySchema,
  reactionSchema,
  reportSchema,
  updatePostSchema,
  uuidSchema,
  zoneIdSchema,
} from "@entroworld/validation";
import { parse } from "../../lib/errors";
import { requireAuth, viewer } from "../../plugins/auth";
import { UsersService } from "../users/service";
import { PostsService } from "./service";

const commentParams = z.object({ id: uuidSchema, commentId: uuidSchema }).strict();
const reactionParams = z.object({ id: uuidSchema, type: reactionSchema.shape.type }).strict();
const zoneParams = z.object({ zoneId: zoneIdSchema }).strict();

export async function postRoutes(app: FastifyInstance): Promise<void> {
  const posts = new PostsService(app.ctx);
  const users = new UsersService(app.ctx);
  app.addHook("preHandler", requireAuth);

  app.post("/", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const post = await posts.create(viewer(request).userId, parse(createPostSchema, request.body));
    return reply.status(201).send(post);
  });

  app.get("/feed", async (request) => posts.feed(viewer(request).userId, parse(pageQuerySchema, request.query)));
  app.get("/discover", async (request) => posts.discover(viewer(request).userId, parse(pageQuerySchema, request.query)));
  app.get("/saved", async (request) => posts.saved(viewer(request).userId, parse(pageQuerySchema, request.query)));
  app.get("/zones/:zoneId", async (request) =>
    posts.zonePosts(viewer(request).userId, parse(zoneParams, request.params).zoneId, parse(pageQuerySchema, request.query)),
  );

  app.get("/:id", async (request) => posts.get(viewer(request).userId, parse(idParamSchema, request.params).id));

  app.patch("/:id", { config: { rateLimit: { max: 30, timeWindow: "1 minute" } } }, async (request) =>
    posts.update(viewer(request), parse(idParamSchema, request.params).id, parse(updatePostSchema, request.body)),
  );

  app.delete("/:id", async (request, reply) => {
    await posts.remove(viewer(request), parse(idParamSchema, request.params).id);
    return reply.status(204).send();
  });

  app.post("/:id/reactions", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (request) => {
    const { id } = parse(idParamSchema, request.params);
    return posts.react(viewer(request).userId, id, parse(reactionSchema, request.body).type, true);
  });

  app.delete("/:id/reactions/:type", async (request) => {
    const { id, type } = parse(reactionParams, request.params);
    return posts.react(viewer(request).userId, id, type, false);
  });

  app.get("/:id/comments", async (request) =>
    posts.comments(viewer(request).userId, parse(idParamSchema, request.params).id, parse(pageQuerySchema, request.query)),
  );

  app.post("/:id/comments", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    const { id } = parse(idParamSchema, request.params);
    const comment = await posts.comment(viewer(request).userId, id, parse(createCommentSchema, request.body).content);
    return reply.status(201).send(comment);
  });

  app.delete("/:id/comments/:commentId", async (request, reply) => {
    const { id, commentId } = parse(commentParams, request.params);
    await posts.removeComment(viewer(request), id, commentId);
    return reply.status(204).send();
  });

  app.post("/:id/report", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request, reply) => {
    const { id } = parse(idParamSchema, request.params);
    const input = parse(reportSchema, request.body);
    const me = viewer(request).userId;
    const post = await posts.findVisible(me, id);
    await users.report(me, { type: "post", userId: post.userId, contentId: post.id }, input);
    return reply.status(202).send();
  });

  app.post("/:id/comments/:commentId/report", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (request, reply) => {
    const { id, commentId } = parse(commentParams, request.params);
    const input = parse(reportSchema, request.body);
    const me = viewer(request).userId;
    const comment = await posts.findComment(me, id, commentId);
    await users.report(me, { type: "comment", userId: comment.userId, contentId: commentId }, input);
    return reply.status(202).send();
  });
}
