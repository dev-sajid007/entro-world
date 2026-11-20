import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ACADEMY_TRACKS, type LessonSeed } from "@entroworld/database";
import { execute } from "@entroworld/puzzle-engine";
import type { LessonSummaryView, TrackView } from "@entroworld/robot-api";
import { call, createHarness, register, type Harness, type TestUser } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

const SEED = ACADEMY_TRACKS[0]!;
/** A lesson's reference action log (lessons about conditions ship a program instead). */
const seedSolution = (l: LessonSeed) => l.solution ?? execute(l.program!, l.puzzle).actions;
const solution = (slug: string) => seedSolution(SEED.lessons.find((l) => l.slug === slug)!);

async function lessons(u: TestUser): Promise<LessonSummaryView[]> {
  const res = await call(h, "GET", "/academy/tracks", { as: u });
  expect(res.statusCode).toBe(200);
  const track = (res.data.tracks as TrackView[]).find((t) => t.slug === SEED.slug)!;
  return track.lessons;
}

const attempt = (u: TestUser, lessonId: string, actions: unknown[]) =>
  call(h, "POST", `/academy/lessons/${lessonId}/attempts`, { as: u, body: { actions, editorMode: "blocks" } });

describe("academy", () => {
  it("lists the seeded track and serves lessons without their solutions", async () => {
    const u = await register(h);
    const list = await lessons(u);
    expect(list.map((l) => l.slug)).toEqual(SEED.lessons.map((l) => l.slug));
    const res = await call(h, "GET", `/academy/lessons/${list[0]!.id}`, { as: u });
    expect(res.statusCode).toBe(200);
    expect(res.data.lesson).toMatchObject({ slug: "hello-robot", trackSlug: SEED.slug, progress: null, draft: null, nextLessonId: list[1]!.id });
    expect(res.data.lesson.puzzle.tiles).toHaveLength(3);
    expect(JSON.stringify(res.data)).not.toContain("solution");
  });

  it("requires sign-in", async () => {
    expect((await call(h, "GET", "/academy/tracks")).statusCode).toBe(401);
  });

  it("verifies attempts by replaying the action log and awards XP only once", async () => {
    const u = await register(h);
    const [first] = await lessons(u);

    // A forged "success" with no valid action log is rejected.
    const empty = await attempt(u, first!.id, []);
    expect(empty.statusCode).toBe(200);
    expect(empty.data).toMatchObject({ success: false, failureReason: "goal_not_reached", xpAwarded: 0 });
    const forged = await call(h, "POST", `/academy/lessons/${first!.id}/attempts`, { as: u, body: { actions: [], editorMode: "blocks", success: true } });
    expect(forged.statusCode).toBe(400);
    const wall = await attempt(u, first!.id, [{ type: "turnLeft" }, { type: "moveForward", steps: 1 }]);
    expect(wall.data).toMatchObject({ success: false, failureReason: "invalid_action" });
    const blocked = await attempt(u, first!.id, [{ type: "moveForward", steps: 6 }]);
    expect(blocked.data).toMatchObject({ success: false, failureReason: "blocked" });

    const ok = await attempt(u, first!.id, solution("hello-robot"));
    expect(ok.data).toMatchObject({
      success: true,
      firstCompletion: true,
      xpAwarded: first!.xpReward,
      badgesAwarded: ["first-steps"],
      worldEffects: ["academy-lab-exit-open"],
      actionCount: 1,
    });

    const again = await attempt(u, first!.id, solution("hello-robot"));
    expect(again.data).toMatchObject({ success: true, firstCompletion: false, xpAwarded: 0, badgesAwarded: [] });

    const progress = await call(h, "GET", "/academy/progress/me", { as: u });
    expect(progress.data.stats).toMatchObject({ totalXp: first!.xpReward, level: 1, currentStreak: 1, longestStreak: 1 });
    expect(progress.data.lessons).toEqual([expect.objectContaining({ lessonId: first!.id, status: "completed", attempts: 5, bestActionCount: 1 })]);

    const badges = await call(h, "GET", "/academy/badges/me", { as: u });
    expect(badges.data.badges.map((b: { slug: string }) => b.slug)).toEqual(["first-steps"]);
  });

  it("awards XP once even when the same solution is submitted concurrently", async () => {
    const u = await register(h);
    const [first] = await lessons(u);
    const results = await Promise.all(Array.from({ length: 5 }, () => attempt(u, first!.id, solution("hello-robot"))));
    expect(results.filter((r) => r.data.firstCompletion)).toHaveLength(1);
    const progress = await call(h, "GET", "/academy/progress/me", { as: u });
    expect(progress.data.stats.totalXp).toBe(first!.xpReward);
  });

  it("grants track badges when the whole track is solved", async () => {
    const u = await register(h);
    const list = await lessons(u);
    const earned: string[] = [];
    let xp = 0;
    for (const l of list) {
      const res = await attempt(u, l.id, solution(l.slug));
      expect(res.data.success).toBe(true);
      earned.push(...res.data.badgesAwarded);
      xp += res.data.xpAwarded;
    }
    expect(earned.sort()).toEqual(["basics-graduate", "first-steps", "logic-builder", "loop-learner"]);
    const progress = await call(h, "GET", "/academy/progress/me", { as: u });
    expect(progress.data.stats).toMatchObject({ totalXp: xp, level: 4 });
  });

  it("rejects action logs over the puzzle's limit", async () => {
    const u = await register(h);
    const [first] = await lessons(u);
    const turns = Array.from({ length: 12 }, () => ({ type: "turnLeft" }));
    const res = await attempt(u, first!.id, turns);
    expect(res.data).toMatchObject({ success: false, failureReason: "too_many_actions" });
    const huge = await attempt(u, first!.id, Array.from({ length: 501 }, () => ({ type: "turnLeft" })));
    expect(huge.statusCode).toBe(400);
  });

  it("rate-limits attempts per lesson", async () => {
    const u = await register(h);
    const [first] = await lessons(u);
    const codes: number[] = [];
    for (let i = 0; i < 22; i++) codes.push((await attempt(u, first!.id, [])).statusCode);
    expect(codes.slice(0, 20).every((c) => c === 200)).toBe(true);
    expect(codes.at(-1)).toBe(429);
  });

  it("saves and returns the viewer's draft only", async () => {
    const u = await register(h);
    const other = await register(h);
    const [first] = await lessons(u);
    const put = await call(h, "PUT", `/academy/lessons/${first!.id}/code`, { as: u, body: { code: '{"blocks":[]}', editorMode: "blocks" } });
    expect(put.statusCode).toBe(204);
    const mine = await call(h, "GET", `/academy/lessons/${first!.id}`, { as: u });
    expect(mine.data.lesson.draft).toEqual({ code: '{"blocks":[]}', editorMode: "blocks" });
    expect(mine.data.lesson.progress).toMatchObject({ status: "in_progress", attempts: 0 });
    const theirs = await call(h, "GET", `/academy/lessons/${first!.id}`, { as: other });
    expect(theirs.data.lesson.draft).toBeNull();
  });

  it("404s unknown lessons", async () => {
    const u = await register(h);
    const res = await call(h, "GET", "/academy/lessons/00000000-0000-4000-8000-000000000000", { as: u });
    expect(res.statusCode).toBe(404);
  });
});
