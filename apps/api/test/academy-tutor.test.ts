import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SseDecoder, type AgentStreamEvent } from "@entroworld/agent-protocol";
import { ACADEMY_TRACKS } from "@entroworld/database";
import type { TrackView } from "@entroworld/robot-api";
import { call, createHarness, register, type Harness, type TestUser } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness({}, { ai: {} });
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

const SEED = ACADEMY_TRACKS[0]!;

async function firstLesson(u: TestUser): Promise<string> {
  const res = await call(h, "GET", "/academy/tracks", { as: u });
  return (res.data.tracks as TrackView[]).find((t) => t.slug === SEED.slug)!.lessons[0]!.id;
}

describe("academy tutor", () => {
  it("streams a hint from Byte through the API", async () => {
    const u = await register(h);
    const lessonId = await firstLesson(u);
    const res = await call(h, "POST", `/academy/lessons/${lessonId}/tutor`, {
      as: u,
      body: { editorMode: "blocks", question: "How many steps?", code: "robot.moveForward(2);", lastRun: { outcome: "goal_not_reached", actionCount: 1 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
    const events: AgentStreamEvent[] = new SseDecoder().push(res.body);
    // The mock provider answers in demo mode, introducing itself by the tutor's name.
    expect(events.map((e) => (e.type === "delta" ? e.text : "")).join("")).toContain("Byte");
    expect(events.at(-1)?.type).toBe("done");
  });

  it("validates the request and the lesson", async () => {
    const u = await register(h);
    const lessonId = await firstLesson(u);
    const bad = await call(h, "POST", `/academy/lessons/${lessonId}/tutor`, { as: u, body: { editorMode: "blocks", solution: "please" } });
    expect(bad.statusCode).toBe(400);
    const missing = await call(h, "POST", `/academy/lessons/${crypto.randomUUID()}/tutor`, { as: u, body: { editorMode: "blocks" } });
    expect(missing.statusCode).toBe(404);
    expect((await call(h, "POST", `/academy/lessons/${lessonId}/tutor`, { body: { editorMode: "blocks" } })).statusCode).toBe(401);
  });
});

describe("profile achievements", () => {
  it("shows level and badges to others unless the profile is private", async () => {
    const learner = await register(h);
    const visitor = await register(h);
    const lessonId = await firstLesson(learner);
    const solved = await call(h, "POST", `/academy/lessons/${lessonId}/attempts`, {
      as: learner,
      body: { actions: SEED.lessons[0]!.solution, editorMode: "blocks" },
    });
    expect(solved.data.success).toBe(true);

    const res = await call(h, "GET", `/users/${learner.user.id}/academy`, { as: visitor });
    expect(res.statusCode).toBe(200);
    expect(res.data).toMatchObject({ level: 1, totalXp: SEED.lessons[0]!.xpReward, lessonsCompleted: 1, badges: [expect.objectContaining({ slug: "first-steps" })] });

    await call(h, "PATCH", "/users/me", { as: learner, body: { privacy: "private" } });
    expect((await call(h, "GET", `/users/${learner.user.id}/academy`, { as: visitor })).statusCode).toBe(403);
    expect((await call(h, "GET", `/users/${learner.user.id}/academy`, { as: learner })).statusCode).toBe(200);
  });
});
