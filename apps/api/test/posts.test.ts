import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { befriend, call, createHarness, register, type Harness, type TestUser } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

const post = async (as: TestUser, body: Record<string, unknown>) => {
  const res = await call(h, "POST", "/posts", { as, body });
  if (res.statusCode !== 201) throw new Error(`post failed: ${res.body}`);
  return res.data;
};

describe("posts", () => {
  it("creates, reads, edits and deletes a post", async () => {
    const a = await register(h);
    const created = await post(a, { content: "  Hello city!  " });
    expect(created).toMatchObject({ content: "Hello city!", postType: "text", visibility: "public", counts: { likes: 0, comments: 0, shares: 0 } });
    expect(created.author.id).toBe(a.user.id);

    const edited = await call(h, "PATCH", `/posts/${created.id}`, { as: a, body: { content: "Hello again" } });
    expect(edited.data.content).toBe("Hello again");

    const other = await register(h);
    expect((await call(h, "PATCH", `/posts/${created.id}`, { as: other, body: { content: "hijack" } })).statusCode).toBe(403);
    expect((await call(h, "DELETE", `/posts/${created.id}`, { as: other })).statusCode).toBe(403);
    expect((await call(h, "DELETE", `/posts/${created.id}`, { as: a })).statusCode).toBe(204);
    expect((await call(h, "GET", `/posts/${created.id}`, { as: a })).statusCode).toBe(404);
  });

  it("rejects empty posts and immediate duplicates", async () => {
    const a = await register(h);
    expect((await call(h, "POST", "/posts", { as: a, body: { content: "   " } })).statusCode).toBe(400);
    await post(a, { content: "same thing" });
    const dup = await call(h, "POST", "/posts", { as: a, body: { content: "same thing" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.data.error.code).toBe("duplicate_post");
  });

  it("creates world location posts and lists them by zone", async () => {
    const a = await register(h);
    const loc = await post(a, { content: "Meet me at the fountain", location: { zoneId: "zone-central", x: 2, y: 0, z: -3 } });
    expect(loc.postType).toBe("location");
    await post(a, { content: "Somewhere else", location: { zoneId: "zone-park", x: 0, y: 0, z: 0 } });
    const central = await call(h, "GET", "/posts/zones/zone-central", { as: a });
    expect(central.data.items.map((p: { id: string }) => p.id)).toEqual([loc.id]);
    expect((await call(h, "POST", "/posts", { as: a, body: { location: { zoneId: "zone-moon", x: 0, y: 0, z: 0 } } })).statusCode).toBe(400);
  });

  it("enforces visibility: public, friends-only and private", async () => {
    const author = await register(h);
    const friend = await register(h);
    const stranger = await register(h);
    await befriend(h, author, friend);
    const pub = await post(author, { content: "for everyone" });
    const fr = await post(author, { content: "for friends", visibility: "friends" });
    const priv = await post(author, { content: "for me", visibility: "private" });

    const seen = async (as: TestUser) =>
      (await call(h, "GET", `/users/${author.user.id}/posts`, { as })).data.items.map((p: { content: string }) => p.content).sort();
    expect(await seen(author)).toEqual(["for everyone", "for friends", "for me"]);
    expect(await seen(friend)).toEqual(["for everyone", "for friends"]);
    expect(await seen(stranger)).toEqual(["for everyone"]);

    expect((await call(h, "GET", `/posts/${fr.id}`, { as: stranger })).statusCode).toBe(404);
    expect((await call(h, "GET", `/posts/${priv.id}`, { as: friend })).statusCode).toBe(404);
    expect((await call(h, "GET", `/posts/${pub.id}`, { as: stranger })).statusCode).toBe(200);

    // A friends-only profile hides even public posts from strangers.
    await call(h, "PATCH", "/users/me", { as: author, body: { privacy: "friends" } });
    expect(await seen(stranger)).toEqual([]);
    expect(await seen(friend)).toEqual(["for everyone", "for friends"]);
  });

  it("builds a feed from yourself, friends and people you follow, newest first, paginated", async () => {
    const me = await register(h);
    const friend = await register(h);
    const followed = await register(h);
    const stranger = await register(h);
    await befriend(h, me, friend);
    await call(h, "POST", `/users/${followed.user.id}/follow`, { as: me });

    const expected: string[] = [];
    for (let i = 0; i < 4; i++) {
      for (const [who, label] of [
        [me, "me"],
        [friend, "friend"],
        [followed, "followed"],
        [stranger, "stranger"],
      ] as const) {
        const p = await post(who, { content: `${label} ${i}` });
        if (label !== "stranger") expected.unshift(p.content);
      }
    }

    const all: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs = cursor ? `?limit=5&cursor=${encodeURIComponent(cursor)}` : "?limit=5";
      const res = await call(h, "GET", `/posts/feed${qs}`, { as: me });
      expect(res.statusCode).toBe(200);
      all.push(...res.data.items.map((p: { content: string }) => p.content));
      cursor = res.data.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(all).toEqual(expected);
    expect(pages).toBe(3);

    const discover = await call(h, "GET", "/posts/discover?limit=50", { as: me });
    expect(discover.data.items).toHaveLength(16);
    expect((await call(h, "GET", "/posts/feed?cursor=garbage", { as: me })).data.error.code).toBe("invalid_cursor");
  });

  it("hides posts across blocks in both directions", async () => {
    const a = await register(h);
    const b = await register(h);
    const p = await post(b, { content: "visible until blocked" });
    await call(h, "POST", `/users/${b.user.id}/block`, { as: a });
    expect((await call(h, "GET", `/posts/${p.id}`, { as: a })).statusCode).toBe(404);
    const mine = await post(a, { content: "the blocker's post" });
    expect((await call(h, "GET", `/posts/${mine.id}`, { as: b })).statusCode).toBe(404);
    expect((await call(h, "GET", "/posts/discover", { as: b })).data.items.map((x: { id: string }) => x.id)).toEqual([p.id]);
  });
});

describe("reactions, comments and shares", () => {
  it("likes and saves are idempotent toggles", async () => {
    const a = await register(h);
    const b = await register(h);
    const p = await post(a, { content: "like me" });
    await call(h, "POST", `/posts/${p.id}/reactions`, { as: b, body: { type: "like" } });
    const twice = await call(h, "POST", `/posts/${p.id}/reactions`, { as: b, body: { type: "like" } });
    expect(twice.data).toMatchObject({ counts: { likes: 1 }, viewer: { liked: true, saved: false } });
    await call(h, "POST", `/posts/${p.id}/reactions`, { as: b, body: { type: "save" } });
    const saved = await call(h, "GET", "/posts/saved", { as: b });
    expect(saved.data.items.map((x: { id: string }) => x.id)).toEqual([p.id]);
    const unliked = await call(h, "DELETE", `/posts/${p.id}/reactions/like`, { as: b });
    expect(unliked.data).toMatchObject({ counts: { likes: 0 }, viewer: { liked: false, saved: true } });
    expect((await call(h, "POST", `/posts/${p.id}/reactions`, { as: b, body: { type: "love" } })).statusCode).toBe(400);
  });

  it("comments in order, with deletion by the commenter or the post author", async () => {
    const author = await register(h);
    const c1 = await register(h);
    const c2 = await register(h);
    const p = await post(author, { content: "discuss" });
    const first = await call(h, "POST", `/posts/${p.id}/comments`, { as: c1, body: { content: "first!" } });
    expect(first.statusCode).toBe(201);
    const second = await call(h, "POST", `/posts/${p.id}/comments`, { as: c2, body: { content: "second" } });
    const list = await call(h, "GET", `/posts/${p.id}/comments`, { as: author });
    expect(list.data.items.map((c: { content: string }) => c.content)).toEqual(["first!", "second"]);
    expect((await call(h, "GET", `/posts/${p.id}`, { as: author })).data.counts.comments).toBe(2);

    expect((await call(h, "DELETE", `/posts/${p.id}/comments/${first.data.id}`, { as: c2 })).statusCode).toBe(403);
    expect((await call(h, "DELETE", `/posts/${p.id}/comments/${first.data.id}`, { as: c1 })).statusCode).toBe(204);
    expect((await call(h, "DELETE", `/posts/${p.id}/comments/${second.data.id}`, { as: author })).statusCode).toBe(204);
    expect((await call(h, "GET", `/posts/${p.id}/comments`, { as: author })).data.items).toEqual([]);
    expect((await call(h, "POST", `/posts/${p.id}/comments`, { as: c1, body: { content: "" } })).statusCode).toBe(400);
  });

  it("cannot comment on posts the viewer can't see", async () => {
    const author = await register(h);
    const stranger = await register(h);
    const p = await post(author, { content: "friends only", visibility: "friends" });
    expect((await call(h, "POST", `/posts/${p.id}/comments`, { as: stranger, body: { content: "hi" } })).statusCode).toBe(404);
  });

  it("shares point at the original post and count on it", async () => {
    const a = await register(h);
    const b = await register(h);
    const c = await register(h);
    const original = await post(a, { content: "original" });
    const share = await post(b, { content: "look at this", sharedPostId: original.id });
    expect(share).toMatchObject({ postType: "share", sharedPost: { id: original.id, content: "original" } });
    const reshare = await post(c, { content: "", sharedPostId: share.id });
    expect(reshare.sharedPost.id).toBe(original.id);
    expect((await call(h, "GET", `/posts/${original.id}`, { as: a })).data.counts.shares).toBe(2);

    const priv = await post(a, { content: "mine only", visibility: "private" });
    expect((await call(h, "POST", "/posts", { as: a, body: { sharedPostId: priv.id } })).data.error.code).toBe("not_shareable");
  });

  it("reports posts and comments", async () => {
    const a = await register(h);
    const b = await register(h);
    const p = await post(a, { content: "report me" });
    const cm = await call(h, "POST", `/posts/${p.id}/comments`, { as: a, body: { content: "and me" } });
    expect((await call(h, "POST", `/posts/${p.id}/report`, { as: b, body: { reason: "spam" } })).statusCode).toBe(202);
    expect((await call(h, "POST", `/posts/${p.id}/comments/${cm.data.id}/report`, { as: b, body: { reason: "harassment" } })).statusCode).toBe(202);
    const rows = await h.db.execute(`select target_type, target_user_id from moderation_reports order by target_type`);
    expect(rows.rows).toEqual([
      { target_type: "comment", target_user_id: a.user.id },
      { target_type: "post", target_user_id: a.user.id },
    ]);
  });

  it("lets moderators remove any post", async () => {
    const a = await register(h);
    const mod = await register(h, "moderator1");
    await h.db.execute(`update users set role = 'moderator' where id = '${mod.user.id}'`);
    const p = await post(a, { content: "against the rules" });
    // Role is carried in the access token, so the moderator signs in again.
    const login = await call(h, "POST", "/auth/login", { body: { login: "moderator1", password: mod.password } });
    expect((await call(h, "DELETE", `/posts/${p.id}`, { as: login.data })).statusCode).toBe(204);
  });
});
