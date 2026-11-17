import { describe, expect, it } from "vitest";
import { levelForXp, levelProgress, nextStreak } from "./progression";
import { puzzleDefinitionSchema } from "./puzzle";
import { lessonAttemptRequestSchema } from "./actions";

describe("progression", () => {
  it("maps XP to levels", () => {
    expect([0, 99, 100, 299, 300, 600].map(levelForXp)).toEqual([1, 1, 2, 2, 3, 4]);
    expect(levelProgress(150)).toEqual({ level: 2, levelXp: 50, levelSpan: 200 });
  });

  it("extends streaks on consecutive days only", () => {
    expect(nextStreak(0, null, "2026-01-01")).toBe(1);
    expect(nextStreak(3, "2026-01-01", "2026-01-01")).toBe(3);
    expect(nextStreak(3, "2025-12-31", "2026-01-01")).toBe(4);
    expect(nextStreak(3, "2025-12-30", "2026-01-01")).toBe(1);
  });
});

describe("schemas", () => {
  const base = {
    width: 3,
    height: 1,
    tiles: ["..."],
    start: { x: 0, y: 0, dir: "E" },
    goal: { reach: { x: 2, y: 0 }, collectAll: false },
    allowedApi: ["moveForward"],
    controls: [],
    maxActions: 5,
    maxBlocks: null,
    par: 1,
  };

  it("validates puzzle definitions", () => {
    expect(puzzleDefinitionSchema.safeParse(base).success).toBe(true);
    expect(puzzleDefinitionSchema.safeParse({ ...base, tiles: [".."] }).success).toBe(false);
    expect(puzzleDefinitionSchema.safeParse({ ...base, tiles: ["#.."] }).success).toBe(false);
    expect(puzzleDefinitionSchema.safeParse({ ...base, goal: { reach: null, collectAll: false } }).success).toBe(false);
  });

  it("rejects unknown or malformed actions", () => {
    const ok = { editorMode: "blocks", actions: [{ type: "moveForward", steps: 2 }, { type: "turnLeft" }] };
    expect(lessonAttemptRequestSchema.safeParse(ok).success).toBe(true);
    for (const bad of [{ type: "teleport" }, { type: "moveForward", steps: 0 }, { type: "moveForward", steps: 1.5 }, { type: "turnLeft", extra: 1 }]) {
      expect(lessonAttemptRequestSchema.safeParse({ ...ok, actions: [bad] }).success).toBe(false);
    }
    expect(lessonAttemptRequestSchema.safeParse({ ...ok, success: true }).success).toBe(false);
  });
});
