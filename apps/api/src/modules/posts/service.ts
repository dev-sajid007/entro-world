import { and, asc, count, desc, eq, gt, gte, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { comments, postMedia, posts, profiles, reactions, users } from "@entroworld/database";
import type { CommentView, Paginated, PostView, ReactionType, ZoneId } from "@entroworld/shared";
import type { CreatePostInput, PageQuery, UpdatePostInput } from "@entroworld/validation";
import type { AppContext } from "../../context";
import { decodeCursor, encodeCursor, page } from "../../lib/cursor";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors";
import type { AccessClaims } from "../../lib/tokens";
import { followsSql, friendsSql, loadPublicUsers, notBlockedSql, visibleAccount } from "../social/relationships";

type PostRow = typeof posts.$inferSelect;

/** Identical text posted again within this window is rejected as spam. */
const DUPLICATE_WINDOW_MS = 60_000;

/**
 * Whether `viewerId` may see a post: never across a block or from a removed account; always their
 * own; otherwise the stricter of the post's visibility and the author's profile privacy applies.
 * Requires `users` and `profiles` joined on the post's author.
 */
export function postVisibleTo(viewerId: string): SQL {
  const privacy = sql`coalesce(${profiles.privacy}, 'public')`;
  return and(
    isNull(posts.deletedAt),
    visibleAccount,
    notBlockedSql(viewerId, posts.userId),
    or(
      eq(posts.userId, viewerId),
      and(eq(posts.visibility, "public"), sql`${privacy} = 'public'`),
      and(inArray(posts.visibility, ["public", "friends"]), sql`${privacy} in ('public', 'friends')`, friendsSql(viewerId, posts.userId)),
    ),
  )!;
}

const isModerator = (claims: AccessClaims) => claims.role === "moderator" || claims.role === "admin";

export class PostsService {
  constructor(private readonly ctx: AppContext) {}

  private get db() {
    return this.ctx.db;
  }

  /** Posts the viewer may see, newest first, matching `where`, with keyset pagination. */
  private async visiblePosts(viewerId: string, where: SQL | undefined, query: PageQuery): Promise<Paginated<PostView>> {
    const cursor = decodeCursor(query.cursor);
    const before = cursor ? or(lt(posts.createdAt, cursor.createdAt), and(eq(posts.createdAt, cursor.createdAt), lt(posts.id, cursor.id))) : undefined;
    const rows = await this.db
      .select({ post: posts })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.userId))
      .leftJoin(profiles, eq(profiles.userId, posts.userId))
      .where(and(postVisibleTo(viewerId), where, before))
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(query.limit + 1);
    const { items, nextCursor } = page(
      rows.map((r) => r.post),
      query.limit,
    );
    return { items: await this.hydrate(viewerId, items), nextCursor };
  }

  /** The viewer's own posts plus those of friends and people they follow. */
  feed(viewerId: string, query: PageQuery): Promise<Paginated<PostView>> {
    return this.visiblePosts(viewerId, or(eq(posts.userId, viewerId), friendsSql(viewerId, posts.userId), followsSql(viewerId, posts.userId)), query);
  }

  /** Recent public posts from everyone (for discovering people). */
  discover(viewerId: string, query: PageQuery): Promise<Paginated<PostView>> {
    return this.visiblePosts(viewerId, eq(posts.visibility, "public"), query);
  }

  userPosts(viewerId: string, authorId: string, query: PageQuery): Promise<Paginated<PostView>> {
    return this.visiblePosts(viewerId, eq(posts.userId, authorId), query);
  }

  /** Location posts pinned to a zone, for showing in the 3D world. */
  zonePosts(viewerId: string, zoneId: ZoneId, query: PageQuery): Promise<Paginated<PostView>> {
    return this.visiblePosts(viewerId, sql`${posts.location}->>'zoneId' = ${zoneId}`, query);
  }

  async saved(viewerId: string, query: PageQuery): Promise<Paginated<PostView>> {
    const cursor = decodeCursor(query.cursor);
    const before = cursor
      ? or(lt(reactions.createdAt, cursor.createdAt), and(eq(reactions.createdAt, cursor.createdAt), lt(reactions.postId, cursor.id)))
      : undefined;
    const rows = await this.db
      .select({ post: posts, savedAt: reactions.createdAt })
      .from(reactions)
      .innerJoin(posts, eq(posts.id, reactions.postId))
      .innerJoin(users, eq(users.id, posts.userId))
      .leftJoin(profiles, eq(profiles.userId, posts.userId))
      .where(and(eq(reactions.userId, viewerId), eq(reactions.reactionType, "save"), postVisibleTo(viewerId), before))
      .orderBy(desc(reactions.createdAt), desc(reactions.postId))
      .limit(query.limit + 1);
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: await this.hydrate(
        viewerId,
        items.map((r) => r.post),
      ),
      nextCursor: rows.length > query.limit && last ? encodeCursor({ createdAt: last.savedAt, id: last.post.id }) : null,
    };
  }

  async get(viewerId: string, postId: string): Promise<PostView> {
    const row = await this.findVisible(viewerId, postId);
    const [view] = await this.hydrate(viewerId, [row]);
    return view!;
  }

  async create(viewerId: string, input: CreatePostInput): Promise<PostView> {
    let sharedPostId: string | null = null;
    if (input.sharedPostId) {
      const target = await this.findVisible(viewerId, input.sharedPostId);
      // Sharing a share shares the original. Each viewer of the share still needs access to the original.
      const original = target.sharedPostId ? await this.findVisible(viewerId, target.sharedPostId) : target;
      if (original.visibility === "private") throw forbidden("Private posts can't be shared", "not_shareable");
      sharedPostId = original.id;
    }

    if (input.content.length > 0) {
      const [dup] = await this.db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.userId, viewerId), eq(posts.content, input.content), isNull(posts.deletedAt), gte(posts.createdAt, new Date(Date.now() - DUPLICATE_WINDOW_MS))))
        .limit(1);
      if (dup) throw conflict("You just posted that", "duplicate_post");
    }

    const postType = sharedPostId ? "share" : input.location ? "location" : "text";
    const [row] = await this.db
      .insert(posts)
      .values({ userId: viewerId, content: input.content, visibility: input.visibility, postType, location: input.location ?? null, sharedPostId })
      .returning();
    const [view] = await this.hydrate(viewerId, [row!]);
    return view!;
  }

  async update(viewer: AccessClaims, postId: string, input: UpdatePostInput): Promise<PostView> {
    const row = await this.findVisible(viewer.userId, postId);
    if (row.userId !== viewer.userId) throw forbidden("You can only edit your own posts");
    const next = { content: input.content ?? row.content, visibility: input.visibility ?? row.visibility };
    if (next.content.length === 0 && !row.sharedPostId && !row.location) throw badRequest("A post can't be empty", "validation_error", { fields: { content: "Write something to post" } });
    const [updated] = await this.db.update(posts).set(next).where(eq(posts.id, postId)).returning();
    const [view] = await this.hydrate(viewer.userId, [updated!]);
    return view!;
  }

  async remove(viewer: AccessClaims, postId: string): Promise<void> {
    const row = await this.findVisible(viewer.userId, postId);
    if (row.userId !== viewer.userId && !isModerator(viewer)) throw forbidden("You can only delete your own posts");
    await this.db.update(posts).set({ deletedAt: new Date() }).where(eq(posts.id, postId));
  }

  async react(viewerId: string, postId: string, type: ReactionType, on: boolean): Promise<PostView> {
    const row = await this.findVisible(viewerId, postId);
    if (on) await this.db.insert(reactions).values({ postId, userId: viewerId, reactionType: type }).onConflictDoNothing();
    else await this.db.delete(reactions).where(and(eq(reactions.postId, postId), eq(reactions.userId, viewerId), eq(reactions.reactionType, type)));
    const [view] = await this.hydrate(viewerId, [row]);
    return view!;
  }

  /** Oldest first, hiding comments from people either side has blocked. */
  async comments(viewerId: string, postId: string, query: PageQuery): Promise<Paginated<CommentView>> {
    await this.findVisible(viewerId, postId);
    const cursor = decodeCursor(query.cursor);
    const after = cursor ? or(gt(comments.createdAt, cursor.createdAt), and(eq(comments.createdAt, cursor.createdAt), gt(comments.id, cursor.id))) : undefined;
    const rows = await this.db
      .select({ id: comments.id, postId: comments.postId, userId: comments.userId, content: comments.content, createdAt: comments.createdAt })
      .from(comments)
      .innerJoin(users, eq(users.id, comments.userId))
      .where(and(eq(comments.postId, postId), isNull(comments.deletedAt), visibleAccount, notBlockedSql(viewerId, comments.userId), after))
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(query.limit + 1);
    const { items, nextCursor } = page(rows, query.limit);
    const authors = await loadPublicUsers(
      this.db,
      items.map((c) => c.userId),
    );
    return {
      items: items.flatMap((c) => {
        const author = authors.get(c.userId);
        return author ? [{ id: c.id, postId: c.postId, author, content: c.content, createdAt: c.createdAt.toISOString() }] : [];
      }),
      nextCursor,
    };
  }

  async comment(viewerId: string, postId: string, content: string): Promise<CommentView> {
    await this.findVisible(viewerId, postId);
    const [row] = await this.db.insert(comments).values({ postId, userId: viewerId, content }).returning();
    const author = (await loadPublicUsers(this.db, [viewerId])).get(viewerId)!;
    return { id: row!.id, postId, author, content: row!.content, createdAt: row!.createdAt.toISOString() };
  }

  /** Comment authors, the post's author and moderators may remove a comment. */
  async removeComment(viewer: AccessClaims, postId: string, commentId: string): Promise<void> {
    const post = await this.findVisible(viewer.userId, postId);
    const [row] = await this.db
      .select({ userId: comments.userId })
      .from(comments)
      .where(and(eq(comments.id, commentId), eq(comments.postId, postId), isNull(comments.deletedAt)))
      .limit(1);
    if (!row) throw notFound("Comment");
    if (row.userId !== viewer.userId && post.userId !== viewer.userId && !isModerator(viewer)) throw forbidden("You can't delete this comment");
    await this.db.update(comments).set({ deletedAt: new Date() }).where(eq(comments.id, commentId));
  }

  /** Loads a comment on a visible post (for reports). */
  async findComment(viewerId: string, postId: string, commentId: string): Promise<{ userId: string }> {
    await this.findVisible(viewerId, postId);
    const [row] = await this.db
      .select({ userId: comments.userId })
      .from(comments)
      .where(and(eq(comments.id, commentId), eq(comments.postId, postId), isNull(comments.deletedAt)))
      .limit(1);
    if (!row) throw notFound("Comment");
    return row;
  }

  /** The post row, or 404 when it doesn't exist or the viewer may not see it. */
  async findVisible(viewerId: string, postId: string): Promise<PostRow> {
    const [row] = await this.db
      .select({ post: posts })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.userId))
      .leftJoin(profiles, eq(profiles.userId, posts.userId))
      .where(and(eq(posts.id, postId), postVisibleTo(viewerId)))
      .limit(1);
    if (!row) throw notFound("Post");
    return row.post;
  }

  /** Builds the API view: authors, media, counts, the viewer's reactions and (visible) shared posts. */
  private async hydrate(viewerId: string, rows: PostRow[]): Promise<PostView[]> {
    if (rows.length === 0) return [];
    const sharedIds = [...new Set(rows.flatMap((r) => (r.sharedPostId ? [r.sharedPostId] : [])))];
    const sharedRows =
      sharedIds.length === 0
        ? []
        : (
            await this.db
              .select({ post: posts })
              .from(posts)
              .innerJoin(users, eq(users.id, posts.userId))
              .leftJoin(profiles, eq(profiles.userId, posts.userId))
              .where(and(inArray(posts.id, sharedIds), postVisibleTo(viewerId)))
          ).map((r) => r.post);
    const all = [...rows, ...sharedRows];
    const ids = [...new Set(all.map((r) => r.id))];

    const [authors, media, likeCounts, commentCounts, shareCounts, mine] = await Promise.all([
      loadPublicUsers(
        this.db,
        all.map((r) => r.userId),
      ),
      this.db.select().from(postMedia).where(inArray(postMedia.postId, ids)).orderBy(asc(postMedia.position)),
      this.db
        .select({ postId: reactions.postId, n: count() })
        .from(reactions)
        .where(and(inArray(reactions.postId, ids), eq(reactions.reactionType, "like")))
        .groupBy(reactions.postId),
      this.db
        .select({ postId: comments.postId, n: count() })
        .from(comments)
        .where(and(inArray(comments.postId, ids), isNull(comments.deletedAt)))
        .groupBy(comments.postId),
      this.db
        .select({ postId: posts.sharedPostId, n: count() })
        .from(posts)
        .where(and(inArray(posts.sharedPostId, ids), isNull(posts.deletedAt)))
        .groupBy(posts.sharedPostId),
      this.db
        .select({ postId: reactions.postId, type: reactions.reactionType })
        .from(reactions)
        .where(and(inArray(reactions.postId, ids), eq(reactions.userId, viewerId))),
    ]);

    const tally = (list: { postId: string | null; n: number }[]) => new Map(list.map((x) => [x.postId, x.n]));
    const likes = tally(likeCounts);
    const commentsN = tally(commentCounts);
    const shares = tally(shareCounts);
    const reacted = new Set(mine.map((m) => `${m.postId}:${m.type}`));

    const base = (r: PostRow): Omit<PostView, "sharedPost"> | null => {
      const author = authors.get(r.userId);
      if (!author) return null;
      return {
        id: r.id,
        author,
        content: r.content,
        postType: r.postType,
        visibility: r.visibility,
        media: media
          .filter((m) => m.postId === r.id)
          .map((m) => ({ id: m.id, url: m.mediaUrl, mediaType: m.mediaType, width: m.metadata.width ?? null, height: m.metadata.height ?? null })),
        location: r.location ?? null,
        event: null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
        counts: { likes: likes.get(r.id) ?? 0, comments: commentsN.get(r.id) ?? 0, shares: shares.get(r.id) ?? 0 },
        viewer: { liked: reacted.has(`${r.id}:like`), saved: reacted.has(`${r.id}:save`) },
      };
    };
    const sharedViews = new Map(sharedRows.map((r) => [r.id, base(r)]));
    return rows.flatMap((r) => {
      const view = base(r);
      if (!view) return [];
      return [{ ...view, sharedPost: r.sharedPostId ? (sharedViews.get(r.sharedPostId) ?? null) : null }];
    });
  }
}
