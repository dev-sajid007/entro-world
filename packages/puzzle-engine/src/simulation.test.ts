import { describe, expect, it } from "vitest";
import type { PuzzleDefinition, RobotAction } from "@entroworld/robot-api";
import { PuzzleSim, replay } from "./simulation";

const puzzle = (over: Partial<PuzzleDefinition> = {}): PuzzleDefinition => ({
  width: 5,
  height: 3,
  tiles: ["#####", "..~B.", "#####"],
  start: { x: 0, y: 1, dir: "E" },
  goal: { reach: { x: 4, y: 1 }, collectAll: false },
  allowedApi: ["moveForward", "turnLeft", "turnRight", "jump", "pickUp", "drop", "say", "isPathClear", "sensor"],
  controls: [],
  maxActions: 10,
  maxBlocks: null,
  par: null,
  ...over,
});

describe("PuzzleSim", () => {
  it("is deterministic: the same actions give the same result", () => {
    const actions: RobotAction[] = [{ type: "moveForward", steps: 1 }, { type: "jump" }, { type: "pickUp" }, { type: "moveForward", steps: 1 }];
    const a = replay(puzzle(), actions);
    const b = replay(puzzle(), actions);
    expect(a).toEqual(b);
    expect(a.success).toBe(true);
    expect(a.final).toEqual({ x: 4, y: 1, dir: "E", carrying: 1 });
  });

  it("stops when the robot is blocked", () => {
    const r = replay(puzzle(), [{ type: "moveForward", steps: 3 }, { type: "moveForward", steps: 1 }]);
    expect(r).toMatchObject({ success: false, failureReason: "blocked", final: { x: 1, y: 1 } });
    expect(r.events.at(-1)).toEqual({ type: "blocked", x: 2, y: 1, cause: "gap" });
    expect(replay(puzzle(), [{ type: "turnLeft" }, { type: "moveForward", steps: 1 }]).events.at(-1)).toMatchObject({ cause: "wall" });
    expect(replay(puzzle(), [{ type: "turnRight" }, { type: "turnRight" }, { type: "moveForward", steps: 1 }]).events.at(-1)).toMatchObject({ cause: "edge" });
  });

  it("cannot jump over walls or land in gaps", () => {
    expect(replay(puzzle({ tiles: ["#####", ".#...", "#####"] }), [{ type: "jump" }]).failureReason).toBe("blocked");
    expect(replay(puzzle({ tiles: ["#####", "..~..", "#####"] }), [{ type: "moveForward", steps: 1 }, { type: "jump" }]).success).toBe(false);
  });

  it("rejects actions the puzzle does not allow", () => {
    const r = replay(puzzle({ allowedApi: ["moveForward"] }), [{ type: "moveForward", steps: 1 }, { type: "jump" }]);
    expect(r.failureReason).toBe("invalid_action");
  });

  it("enforces the action budget", () => {
    const turns = Array.from({ length: 11 }, (): RobotAction => ({ type: "turnLeft" }));
    expect(replay(puzzle(), turns).failureReason).toBe("too_many_actions");
    const sim = new PuzzleSim(puzzle({ maxActions: 2 }));
    expect(sim.apply({ type: "turnLeft" })).toBe(true);
    expect(sim.apply({ type: "turnLeft" })).toBe(true);
    expect(sim.apply({ type: "turnLeft" })).toBe(false);
    expect(sim.failure).toBe("too_many_actions");
  });

  it("checks collect goals at the end of the run", () => {
    const p = puzzle({ tiles: ["#####", "...B.", "#####"], goal: { reach: { x: 4, y: 1 }, collectAll: true } });
    expect(replay(p, [{ type: "moveForward", steps: 4 }]).failureReason).toBe("goal_not_reached");
    expect(replay(p, [{ type: "moveForward", steps: 3 }, { type: "pickUp" }, { type: "moveForward", steps: 1 }]).success).toBe(true);
    // Dropping the battery again puts it back on the floor.
    expect(replay(p, [{ type: "moveForward", steps: 3 }, { type: "pickUp" }, { type: "moveForward", steps: 1 }, { type: "drop" }]).success).toBe(false);
    // Passing the goal and walking away does not count.
    expect(replay(puzzle({ tiles: ["#####", ".....", "#####"], goal: { reach: { x: 2, y: 1 }, collectAll: false } }), [{ type: "moveForward", steps: 3 }]).success).toBe(false);
  });

  it("reports sensors without recording actions", () => {
    const sim = new PuzzleSim(puzzle());
    expect(sim.isPathClear()).toBe(true);
    expect(sim.sense("left")).toBe("wall");
    sim.apply({ type: "moveForward", steps: 1 });
    expect(sim.sense("front")).toBe("wall");
    expect(sim.actionCount).toBe(1);
    expect(sim.batteryCells()).toEqual([[3, 1]]);
  });

  it("pickUp on an empty tile is harmless", () => {
    const r = replay(puzzle({ tiles: ["#####", ".....", "#####"] }), [{ type: "pickUp" }, { type: "moveForward", steps: 4 }]);
    expect(r.success).toBe(true);
    expect(r.events[0]).toEqual({ type: "pickUp", x: 0, y: 1, ok: false });
  });
});
