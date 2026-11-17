import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { jwtVerify } from "jose";
import { USER_CONTROL_CHANNEL, onlineKey, type UserControl } from "@entroworld/game-protocol";
import { befriend, call, createHarness, register, type Harness, type TestUser } from "./harness";

const LIVEKIT_SECRET = "test-livekit-secret-0123456789abcdef0123";
let h: Harness;
let sub: Redis;
let events: UserControl[] = [];

beforeAll(async () => {
  h = await createHarness({
    LIVEKIT_URL: "http://127.0.0.1:7880",
    LIVEKIT_PUBLIC_URL: "ws://localhost:7880",
    LIVEKIT_API_KEY: "test-key",
    LIVEKIT_API_SECRET: LIVEKIT_SECRET,
  });
  sub = new Redis(h.env.REDIS_URL);
  await sub.subscribe(USER_CONTROL_CHANNEL);
  sub.on("message", (_channel, message) => events.push(JSON.parse(message)));
});
afterAll(async () => {
  sub.disconnect();
  await h.close();
});
beforeEach(async () => {
  await h.reset();
  events = [];
});

const online = (...users: TestUser[]) => Promise.all(users.map((u) => h.redis.set(onlineKey(u.user.id), "zone-central", "EX", 60)));
const settle = () => new Promise((r) => setTimeout(r, 50));
const eventsFor = (u: TestUser) => events.filter((e): e is Extract<UserControl, { type: "call" }> => e.type === "call" && e.userId === u.user.id).map((e) => e.event);

async function friendsInWorld(): Promise<[TestUser, TestUser]> {
  const a = await register(h);
  const b = await register(h);
  await befriend(h, a, b);
  await online(a, b);
  return [a, b];
}

describe("calls", () => {
  it("rings a friend, connects both sides to the same private room, and hangs up", async () => {
    const [a, b] = await friendsInWorld();
    const started = await call(h, "POST", "/calls", { as: a, body: { calleeId: b.user.id } });
    expect(started.statusCode).toBe(201);
    const id = started.data.call.id;
    expect(started.data.call).toMatchObject({ status: "ringing", caller: { id: a.user.id }, callee: { id: b.user.id } });
    await settle();
    expect(eventsFor(b)).toEqual([{ kind: "incoming", call: started.data.call }]);
    expect((await call(h, "GET", "/calls/current", { as: b })).data.call.id).toBe(id);

    // The caller can't answer their own call, and nobody can join before it's answered.
    expect((await call(h, "POST", `/calls/${id}/accept`, { as: a })).statusCode).toBe(403);
    expect((await call(h, "POST", `/calls/${id}/join`, { as: a })).statusCode).toBe(409);

    const accepted = await call(h, "POST", `/calls/${id}/accept`, { as: b });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.data.call.status).toBe("active");
    await settle();
    expect(eventsFor(a)).toEqual([{ kind: "accepted", callId: id }]);
    const joined = await call(h, "POST", `/calls/${id}/join`, { as: a });
    expect(joined.data.voice.room).toBe(accepted.data.voice.room);
    expect(joined.data.voice.url).toBe("ws://localhost:7880");

    const key = new TextEncoder().encode(LIVEKIT_SECRET);
    const claims = (await jwtVerify(joined.data.voice.token, key)).payload as { sub: string; video: { room: string; roomJoin: boolean } };
    expect(claims.sub).toBe(a.user.id);
    expect(claims.video).toMatchObject({ room: `ew-call-${id}`, roomJoin: true });

    expect((await call(h, "POST", `/calls/${id}/end`, { as: a, body: {} })).statusCode).toBe(204);
    await settle();
    expect(eventsFor(b).at(-1)).toEqual({ kind: "ended", callId: id, reason: "hangup" });
    // Ending twice is harmless, and both are free for new calls.
    expect((await call(h, "POST", `/calls/${id}/end`, { as: b, body: {} })).statusCode).toBe(404);
    expect((await call(h, "GET", "/calls/current", { as: a })).data.call).toBeNull();
    expect((await call(h, "POST", "/calls", { as: b, body: { calleeId: a.user.id } })).statusCode).toBe(201);
  });

  it("tells the caller why an unanswered call ended", async () => {
    const [a, b] = await friendsInWorld();
    const declined = (await call(h, "POST", "/calls", { as: a, body: { calleeId: b.user.id } })).data.call.id;
    await call(h, "POST", `/calls/${declined}/end`, { as: b, body: {} });
    const missed = (await call(h, "POST", "/calls", { as: a, body: { calleeId: b.user.id } })).data.call.id;
    await call(h, "POST", `/calls/${missed}/end`, { as: a, body: { reason: "missed" } });
    const cancelled = (await call(h, "POST", "/calls", { as: a, body: { calleeId: b.user.id } })).data.call.id;
    await call(h, "POST", `/calls/${cancelled}/end`, { as: a, body: {} });
    await settle();
    expect(eventsFor(a).filter((e) => e.kind === "ended")).toEqual([{ kind: "ended", callId: declined, reason: "declined" }]);
    expect(eventsFor(b).filter((e) => e.kind === "ended").map((e) => e.kind === "ended" && e.reason)).toEqual(["missed", "cancelled"]);
    // An answer that arrives after the caller gave up fails cleanly.
    expect((await call(h, "POST", `/calls/${cancelled}/accept`, { as: b })).statusCode).toBe(404);
  });

  it("only lets friends who are in the city call each other", async () => {
    const a = await register(h);
    const b = await register(h);
    await online(a, b);
    expect((await call(h, "POST", "/calls", { as: a, body: { calleeId: b.user.id } })).data.error.code).toBe("not_friends");
    await befriend(h, a, b);
    await h.redis.del(onlineKey(b.user.id));
    expect((await call(h, "POST", "/calls", { as: a, body: { calleeId: b.user.id } })).data.error.code).toBe("callee_offline");
    await online(b);
    await h.redis.del(onlineKey(a.user.id));
    expect((await call(h, "POST", "/calls", { as: a, body: { calleeId: b.user.id } })).data.error.code).toBe("not_in_world");
    await online(a);
    expect((await call(h, "POST", "/calls", { as: a, body: { calleeId: a.user.id } })).statusCode).toBe(400);
    // Blocking hides the user entirely.
    await call(h, "POST", `/users/${a.user.id}/block`, { as: b });
    expect((await call(h, "POST", "/calls", { as: a, body: { calleeId: b.user.id } })).statusCode).toBe(404);
  });

  it("reports busy friends and keeps strangers out of a call", async () => {
    const [a, b] = await friendsInWorld();
    const c = await register(h);
    await befriend(h, c, b);
    await befriend(h, c, a);
    await online(c);
    const id = (await call(h, "POST", "/calls", { as: a, body: { calleeId: b.user.id } })).data.call.id;
    expect((await call(h, "POST", "/calls", { as: c, body: { calleeId: b.user.id } })).data.error.code).toBe("callee_busy");
    expect((await call(h, "POST", "/calls", { as: a, body: { calleeId: c.user.id } })).data.error.code).toBe("already_in_call");
    for (const action of ["accept", "join", "end"]) {
      expect((await call(h, "POST", `/calls/${id}/${action}`, { as: c, body: {} })).statusCode).toBe(404);
    }
    expect((await call(h, "GET", "/calls/current", { as: c })).data.call).toBeNull();
  });

  it("requires sign-in", async () => {
    expect((await call(h, "POST", "/calls", { body: { calleeId: crypto.randomUUID() } })).statusCode).toBe(401);
  });
});
