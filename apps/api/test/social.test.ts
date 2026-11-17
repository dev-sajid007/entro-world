import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { onlineKey } from "@entroworld/game-protocol";
import { befriend, call, createHarness, register, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

describe("profiles", () => {
  it("edits display name, bio and privacy", async () => {
    const u = await register(h, "editor");
    const res = await call(h, "PATCH", "/users/me", { as: u, body: { displayName: "New Name", bio: "Hello\nthere​", privacy: "friends" } });
    expect(res.statusCode).toBe(200);
    expect(res.data.displayName).toBe("New Name");
    const profile = await call(h, "GET", `/users/${u.user.id}/profile`, { as: u });
    expect(profile.data).toMatchObject({ bio: "Hello\nthere", privacy: "friends", restricted: false, relationship: { isSelf: true } });
    expect((await call(h, "PATCH", "/users/me", { as: u, body: {} })).statusCode).toBe(400);
  });

  it("finds profiles by username or id", async () => {
    const a = await register(h, "findme");
    const b = await register(h);
    const byName = await call(h, "GET", "/users/FindMe", { as: b });
    expect(byName.statusCode).toBe(200);
    expect(byName.data.user.id).toBe(a.user.id);
    expect((await call(h, "GET", `/users/${a.user.id}`, { as: b })).data.user.username).toBe("findme");
    expect((await call(h, "GET", "/users/nobody_here", { as: b })).statusCode).toBe(404);
  });

  it("redacts private profiles for non-friends", async () => {
    const owner = await register(h);
    const stranger = await register(h);
    const friend = await register(h);
    await befriend(h, owner, friend);
    await call(h, "PATCH", "/users/me", { as: owner, body: { bio: "secret bio", privacy: "friends" } });

    const asStranger = await call(h, "GET", `/users/${owner.user.id}/profile`, { as: stranger });
    expect(asStranger.data).toMatchObject({ bio: "", restricted: true, stats: { friends: 0 } });
    expect((await call(h, "GET", `/users/${owner.user.id}/friends`, { as: stranger })).statusCode).toBe(403);

    const asFriend = await call(h, "GET", `/users/${owner.user.id}/profile`, { as: friend });
    expect(asFriend.data).toMatchObject({ bio: "secret bio", restricted: false, stats: { friends: 1 }, relationship: { friendship: "friends" } });
  });

  it("persists the avatar and rejects invalid configurations", async () => {
    const u = await register(h);
    const current = await call(h, "GET", "/users/me/avatar", { as: u });
    expect(current.statusCode).toBe(200);
    const bodyType = current.data.appearance.bodyType === "slim" ? "broad" : "slim";
    const next = { ...current.data, appearance: { ...current.data.appearance, bodyType } };
    const saved = await call(h, "PUT", "/users/me/avatar", { as: u, body: next });
    expect(saved.statusCode).toBe(200);
    expect((await call(h, "GET", "/users/me/avatar", { as: u })).data.appearance.bodyType).toBe(bodyType);
    expect((await call(h, "GET", `/users/${u.user.id}/profile`, { as: u })).data.avatar.appearance.bodyType).toBe(bodyType);
    const bad = await call(h, "PUT", "/users/me/avatar", { as: u, body: { ...next, modelId: "../../etc/passwd" } });
    expect(bad.statusCode).toBe(400);
  });

  it("searches by username prefix and display name", async () => {
    const me = await register(h, "searcher");
    await register(h, "marigold");
    await register(h, "mariner");
    const hidden = await register(h, "maribel");
    await call(h, "POST", `/users/${me.user.id}/block`, { as: hidden });
    const res = await call(h, "GET", "/users/search?q=mari", { as: me });
    expect(res.data.map((u: { username: string }) => u.username).sort()).toEqual(["marigold", "mariner"]);
    expect((await call(h, "GET", "/users/search?q=%25", { as: me })).data).toEqual([]); // LIKE wildcards are literal
  });
});

describe("friends", () => {
  it("sends, lists, accepts and removes friend requests", async () => {
    const a = await register(h);
    const b = await register(h);
    const req = await call(h, "POST", "/friends/requests", { as: a, body: { userId: b.user.id } });
    expect(req.statusCode).toBe(201);
    expect((await call(h, "POST", "/friends/requests", { as: a, body: { userId: b.user.id } })).data.requestId).toBe(req.data.requestId); // idempotent

    const inbox = await call(h, "GET", "/friends/requests", { as: b });
    expect(inbox.data.incoming).toHaveLength(1);
    expect(inbox.data.incoming[0].from.id).toBe(a.user.id);
    expect((await call(h, "GET", "/friends/requests", { as: a })).data.outgoing).toHaveLength(1);

    // Only the addressee can accept.
    expect((await call(h, "POST", `/friends/requests/${req.data.requestId}/accept`, { as: a })).statusCode).toBe(404);
    expect((await call(h, "POST", `/friends/requests/${req.data.requestId}/accept`, { as: b })).statusCode).toBe(204);
    expect((await call(h, "GET", "/friends", { as: a })).data.map((f: { id: string }) => f.id)).toEqual([b.user.id]);

    expect((await call(h, "DELETE", `/friends/${a.user.id}`, { as: b })).statusCode).toBe(204);
    expect((await call(h, "GET", "/friends", { as: a })).data).toEqual([]);
  });

  it("accepts automatically when both people send a request", async () => {
    const a = await register(h);
    const b = await register(h);
    await call(h, "POST", "/friends/requests", { as: a, body: { userId: b.user.id } });
    const back = await call(h, "POST", "/friends/requests", { as: b, body: { userId: a.user.id } });
    expect(back.statusCode).toBe(200);
    expect(back.data.status).toBe("friends");
  });

  it("rejects and cancels requests", async () => {
    const a = await register(h);
    const b = await register(h);
    const r1 = await call(h, "POST", "/friends/requests", { as: a, body: { userId: b.user.id } });
    expect((await call(h, "POST", `/friends/requests/${r1.data.requestId}/reject`, { as: b })).statusCode).toBe(204);
    const r2 = await call(h, "POST", "/friends/requests", { as: a, body: { userId: b.user.id } });
    expect((await call(h, "DELETE", `/friends/requests/${r2.data.requestId}`, { as: a })).statusCode).toBe(204);
    expect((await call(h, "GET", "/friends/requests", { as: b })).data.incoming).toEqual([]);
  });

  it("refuses requests to yourself and unknown users", async () => {
    const a = await register(h);
    expect((await call(h, "POST", "/friends/requests", { as: a, body: { userId: a.user.id } })).statusCode).toBe(400);
    expect((await call(h, "POST", "/friends/requests", { as: a, body: { userId: "00000000-0000-4000-8000-000000000000" } })).statusCode).toBe(404);
  });

  it("shows friends' online zones only to the list owner", async () => {
    const a = await register(h);
    const b = await register(h);
    const c = await register(h);
    await befriend(h, a, b);
    await befriend(h, c, b);
    await h.redis.set(onlineKey(b.user.id), "zone-park", "EX", 60);
    const mine = await call(h, "GET", "/friends", { as: a });
    expect(mine.data[0]).toMatchObject({ id: b.user.id, online: true, zoneId: "zone-park" });
    const theirs = await call(h, "GET", `/users/${c.user.id}/friends`, { as: a });
    expect(theirs.data[0]).toMatchObject({ id: b.user.id, online: false, zoneId: null });
    expect((await call(h, "GET", `/users/${b.user.id}/profile`, { as: a })).data.location).toEqual({ zoneId: "zone-park" });
    const stranger = await register(h);
    expect((await call(h, "GET", `/users/${b.user.id}/profile`, { as: stranger })).data).toMatchObject({ online: false, location: null });
  });
});

describe("follows and blocks", () => {
  it("follows and unfollows", async () => {
    const a = await register(h);
    const b = await register(h);
    expect((await call(h, "POST", `/users/${b.user.id}/follow`, { as: a })).statusCode).toBe(204);
    const profile = await call(h, "GET", `/users/${b.user.id}/profile`, { as: a });
    expect(profile.data.relationship.following).toBe(true);
    expect(profile.data.stats.followers).toBe(1);
    await call(h, "DELETE", `/users/${b.user.id}/follow`, { as: a });
    expect((await call(h, "GET", `/users/${b.user.id}/profile`, { as: a })).data.relationship.following).toBe(false);
  });

  it("blocking ends friendship, hides the blocker, and prevents new contact", async () => {
    const a = await register(h);
    const b = await register(h);
    await befriend(h, a, b);
    await call(h, "POST", `/users/${a.user.id}/follow`, { as: b });
    expect((await call(h, "POST", `/users/${b.user.id}/block`, { as: a })).statusCode).toBe(204);

    expect((await call(h, "GET", "/friends", { as: a })).data).toEqual([]);
    expect((await call(h, "GET", `/users/${a.user.id}/profile`, { as: b })).statusCode).toBe(404);
    const blockerView = await call(h, "GET", `/users/${b.user.id}/profile`, { as: a });
    expect(blockerView.data).toMatchObject({ restricted: true, relationship: { friendship: "blocked", followsYou: false } });
    expect((await call(h, "POST", "/friends/requests", { as: b, body: { userId: a.user.id } })).statusCode).toBe(404);
    expect((await call(h, "POST", "/friends/requests", { as: a, body: { userId: b.user.id } })).data.error.code).toBe("blocked");
    expect((await call(h, "GET", "/users/me/blocked", { as: a })).data.map((u: { id: string }) => u.id)).toEqual([b.user.id]);

    await call(h, "DELETE", `/users/${b.user.id}/block`, { as: a });
    expect((await call(h, "GET", `/users/${a.user.id}/profile`, { as: b })).statusCode).toBe(200);
  });

  it("files reports once per open case", async () => {
    const a = await register(h);
    const b = await register(h);
    const body = { reason: "spam", details: "selling things" };
    expect((await call(h, "POST", `/users/${b.user.id}/report`, { as: a, body })).statusCode).toBe(202);
    expect((await call(h, "POST", `/users/${b.user.id}/report`, { as: a, body })).statusCode).toBe(202);
    const rows = await h.db.execute(`select count(*)::int as n from moderation_reports`);
    expect(rows.rows[0]).toEqual({ n: 1 });
    expect((await call(h, "POST", `/users/${b.user.id}/report`, { as: a, body: { reason: "bogus" } })).statusCode).toBe(400);
  });
});
