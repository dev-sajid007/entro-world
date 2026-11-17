import { describe, expect, it } from "vitest";
import { replay } from "@entroworld/puzzle-engine";
import { lessonContentSchema, puzzleDefinitionSchema } from "@entroworld/robot-api";
import { ACADEMY_BADGES, ACADEMY_TRACKS } from "./academy-seed";

describe("academy curriculum", () => {
  const all = ACADEMY_TRACKS.flatMap((t) => t.lessons);

  it("has five valid beginner puzzles with unique slugs", () => {
    expect(all).toHaveLength(5);
    expect(new Set(all.map((l) => l.slug)).size).toBe(all.length);
    for (const l of all) {
      expect(puzzleDefinitionSchema.safeParse(l.puzzle).error).toBeUndefined();
      expect(lessonContentSchema.safeParse(l.content).error).toBeUndefined();
    }
  });

  it.each(all.map((l) => [l.slug, l] as const))("%s is solvable within its limits and par", (_slug, lesson) => {
    const result = replay(lesson.puzzle, lesson.solution);
    expect(result).toMatchObject({ success: true });
    expect(lesson.solution.length).toBeLessThanOrEqual(lesson.puzzle.maxActions);
    expect(lesson.solution.length).toBe(lesson.puzzle.par);
    for (const a of lesson.solution) expect(lesson.puzzle.allowedApi).toContain(a.type);
  });

  it("is not solved by doing nothing", () => {
    for (const l of all) expect(replay(l.puzzle, []).success).toBe(false);
  });

  it("badges reference real lessons and tracks", () => {
    const slugs = new Set(all.map((l) => l.slug));
    for (const b of ACADEMY_BADGES) {
      if (b.criteria.type === "lessons_set") for (const s of b.criteria.lessons) expect(slugs.has(s)).toBe(true);
      if (b.criteria.type === "track_completed") expect(ACADEMY_TRACKS.map((t) => t.slug)).toContain(b.criteria.track);
    }
  });
});
