import { describe, expect, it } from "vitest";
import { execute, replay } from "@entroworld/puzzle-engine";
import { lessonContentSchema, puzzleDefinitionSchema } from "@entroworld/robot-api";
import { ACADEMY_BADGES, ACADEMY_TRACKS } from "./academy-seed";

describe("academy curriculum", () => {
  const all = ACADEMY_TRACKS.flatMap((t) => t.lessons);

  it("has eight valid beginner puzzles with unique slugs", () => {
    expect(all).toHaveLength(8);
    expect(new Set(all.map((l) => l.slug)).size).toBe(all.length);
    for (const l of all) {
      expect(puzzleDefinitionSchema.safeParse(l.puzzle).error).toBeUndefined();
      expect(lessonContentSchema.safeParse(l.content).error).toBeUndefined();
    }
  });

  it.each(all.map((l) => [l.slug, l] as const))("%s is solvable within its limits and par", (_slug, lesson) => {
    expect(Boolean(lesson.solution) !== Boolean(lesson.program)).toBe(true);
    let solution = lesson.solution ?? [];
    if (lesson.program) {
      // The reference program must run in the same sandbox code the browser uses.
      const run = execute(lesson.program, lesson.puzzle);
      expect(run.error).toBeUndefined();
      expect(run.success).toBe(true);
      solution = run.actions;
    }
    const result = replay(lesson.puzzle, solution);
    expect(result).toMatchObject({ success: true });
    expect(solution.length).toBeLessThanOrEqual(lesson.puzzle.maxActions);
    expect(solution.length).toBe(lesson.puzzle.par);
    for (const a of solution) expect(lesson.puzzle.allowedApi).toContain(a.type);
  });

  it("needs conditions where the lesson teaches them", () => {
    // Writing the winding path out move by move takes far more blocks than the lesson allows.
    const winding = all.find((l) => l.slug === "winding-path")!;
    const straightLine = [2, 2, 2, 2, 2, 4, 3, 2, 3].length * 2 - 1;
    expect(straightLine).toBeGreaterThan(winding.puzzle.maxBlocks!);
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
