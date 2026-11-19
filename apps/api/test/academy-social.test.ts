import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import { jwtVerify } from "jose";
import { academyXpEvents, ACADEMY_TRACKS } from "@entroworld/database";
import { USER_CONTROL_CHANNEL, type UserControl } from "@entroworld/game-protocol";
import { ACADEMY_TICKET_AUDIENCE, academyTicketClaimsSchema, type LeaderboardView, type LessonSummaryView, type TrackView } from "@entroworld/robot-api";
import { weekStartUtc } from "../src/modules/academy/service";
import { befriend, call, createHarness, register, type Harness, type TestUser } from "./harness";

let h: Harness;
let sub: Redis;
let events: UserControl[] = [];

beforeAll(async () => {
  h = await createHarness();
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

const SEED = ACADEMY_TRACKS[0]!;
const settle = () => new Promise((r) => setTimeout(r, 50));

async function lessons(u: TestUser): Promise<LessonSummaryView[]> {
  const res = await call(h, "GET", "/academy/tracks", { as: u });
  return (res.data.tracks as TrackView[]).find((t) => t.slug === SEED.slug)!.lessons;
}

async function solve(u: TestUser, count: number): Promise<number> {
  const list = await lessons(u);
  let xp = 0;
  for (const l of list.slice(0, count)) {
    const actions = SEED.lessons.find((s) => s.slug === l.slug)!.solution;
    const res = await call(h, "POST", `/academy/lessons/${l.id}/attempts`, { as: u, body: { actions, editorMode: "blocks" } });
    expect(res.data.success).toBe(true);
    xp += l.xpReward;
  }
  return xp;
}

const board = async (u: TestUser, scope: "friends" | "global") => {
  const res = await call(h, "GET", `/academy/leaderboard?scope=${scope}`, { as: u });
  expect(res.statusCode).toBe(200);
  return res.data as LeaderboardView;
};

describe("weekly leaderboard", () => {
  it("starts weeks on Monday 00:00 UTC", () => {
    expect(weekStartUtc(new Date("2026-11-19T15:00:00Z")).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(weekStartUtc(new Date("2026-11-16T00:00:00Z")).toISOString()).toBe("2026-11-16T00:00:00.000Z");
    expect(weekStartUtc(new Date("2026-11-22T23:59:59Z")).toISOString()).toBe("2026-11-16T00:00:00.000Z");
  });

  it("ranks this week's XP among friends, or globally", async () => {
    const [a, b, c] = [await register(h), await register(h), await register(h)];
    await befriend(h, a, b);
    const xpA = await solve(a, 1);
    const xpB = await solve(b, 2);
    const xpC = await solve(c, 3);

    const friends = await board(a, "friends");
    expect(friends.entries.map((e) => [e.user.id, e.weeklyXp, e.rank])).toEqual([
      [b.user.id, xpB, 1],
      [a.user.id, xpA, 2],
    ]);
    expect(friends.me).toMatchObject({ rank: 2, weeklyXp: xpA, user: { username: a.user.username } });

    const global = await board(a, "global");
    expect(global.entries.map((e) => e.user.id)).toEqual([c.user.id, b.user.id, a.user.id]);
    expect(global.entries[0]).toMatchObject({ weeklyXp: xpC, rank: 1, level: expect.any(Number) });
    expect(new Date(global.weekEnd).getTime() - new Date(global.weekStart).getTime()).toBe(7 * 24 * 3600 * 1000);
  });

  it("only counts XP earned this week, and shows nothing for a quiet week", async () => {
    const a = await register(h);
    expect((await board(a, "friends")).me).toBeNull();
    const lastWeek = new Date(weekStartUtc(new Date()).getTime() - 24 * 3600 * 1000);
    await h.db.insert(academyXpEvents).values({ userId: a.user.id, xp: 500, createdAt: lastWeek });
    expect((await board(a, "global")).me).toBeNull();
    const xp = await solve(a, 1);
    expect((await board(a, "global")).me?.weeklyXp).toBe(xp);
  });

  it("leaves out users who blocked each other", async () => {
    const [a, b] = [await register(h), await register(h)];
    await solve(b, 1);
    expect((await board(a, "global")).entries.map((e) => e.user.id)).toContain(b.user.id);
    expect((await call(h, "POST", `/users/${b.user.id}/block`, { as: a })).statusCode).toBeLessThan(300);
    expect((await board(a, "global")).entries.map((e) => e.user.id)).not.toContain(b.user.id);
  });

  it("validates the scope", async () => {
    const a = await register(h);
    expect((await call(h, "GET", "/academy/leaderboard?scope=everyone", { as: a })).statusCode).toBe(400);
  });
});

describe("academy sessions", () => {
  const invitesFor = (u: TestUser) =>
    events.filter((e): e is Extract<UserControl, { type: "academy_invite" }> => e.type === "academy_invite" && e.userId === u.user.id).map((e) => e.invite);

  async function claims(ticket: string) {
    const { payload } = await jwtVerify(ticket, new TextEncoder().encode(h.env.GAME_TICKET_SECRET), { audience: ACADEMY_TICKET_AUDIENCE });
    return academyTicketClaimsSchema.parse(payload);
  }

  it("invites a friend, who gets a ticket for the same session", async () => {
    const [a, b] = [await register(h), await register(h)];
    await befriend(h, a, b);
    const [lesson] = await lessons(a);
    const created = await call(h, "POST", "/academy/sessions", { as: a, body: { kind: "battle", lessonId: lesson!.id, friendId: b.user.id } });
    expect(created.statusCode).toBe(201);
    const session = created.data.session;
    expect(session).toMatchObject({ kind: "battle", lesson: { id: lesson!.id, title: lesson!.title }, host: { id: a.user.id }, guest: { id: b.user.id } });
    expect(await claims(created.data.ticket)).toMatchObject({ sub: a.user.id, sessionId: session.id, kind: "battle", lessonId: lesson!.id, members: [a.user.id, b.user.id] });

    await settle();
    expect(invitesFor(b)).toEqual([{ sessionId: session.id, kind: "battle", lessonTitle: lesson!.title, from: { id: a.user.id, displayName: a.user.displayName } }]);
    const invites = await call(h, "GET", "/academy/sessions/invites", { as: b });
    expect(invites.data.invites.map((s: { id: string }) => s.id)).toEqual([session.id]);

    const joined = await call(h, "POST", `/academy/sessions/${session.id}/join`, { as: b });
    expect(joined.statusCode).toBe(200);
    expect(await claims(joined.data.ticket)).toMatchObject({ sub: b.user.id, sessionId: session.id, members: [a.user.id, b.user.id] });
    // Accepted invitations leave the list.
    expect((await call(h, "GET", "/academy/sessions/invites", { as: b })).data.invites).toEqual([]);
  });

  it("only allows friends, and only members can join", async () => {
    const [a, b, c] = [await register(h), await register(h), await register(h)];
    const [lesson] = await lessons(a);
    const body = { kind: "pair", lessonId: lesson!.id, friendId: b.user.id };
    expect((await call(h, "POST", "/academy/sessions", { as: a, body })).statusCode).toBe(403);
    expect((await call(h, "POST", "/academy/sessions", { as: a, body: { ...body, friendId: a.user.id } })).statusCode).toBe(400);
    await befriend(h, a, b);
    expect((await call(h, "POST", "/academy/sessions", { as: a, body: { ...body, lessonId: "00000000-0000-4000-8000-000000000000" } })).statusCode).toBe(404);
    const created = await call(h, "POST", "/academy/sessions", { as: a, body });
    expect(created.statusCode).toBe(201);
    expect((await call(h, "POST", `/academy/sessions/${created.data.session.id}/join`, { as: c })).statusCode).toBe(404);
  });

  it("lets the guest decline and the host call it off", async () => {
    const [a, b] = [await register(h), await register(h)];
    await befriend(h, a, b);
    const [lesson] = await lessons(a);
    const body = { kind: "pair", lessonId: lesson!.id, friendId: b.user.id };
    const first = (await call(h, "POST", "/academy/sessions", { as: a, body })).data.session.id;
    const second = (await call(h, "POST", "/academy/sessions", { as: a, body })).data.session.id;
    expect((await call(h, "DELETE", `/academy/sessions/${first}`, { as: b })).statusCode).toBe(204);
    expect((await call(h, "GET", "/academy/sessions/invites", { as: b })).data.invites.map((s: { id: string }) => s.id)).toEqual([second]);
    expect((await call(h, "DELETE", `/academy/sessions/${second}`, { as: a })).statusCode).toBe(204);
    expect((await call(h, "GET", "/academy/sessions/invites", { as: b })).data.invites).toEqual([]);
    expect((await call(h, "POST", `/academy/sessions/${second}/join`, { as: b })).statusCode).toBe(404);
  });
});
