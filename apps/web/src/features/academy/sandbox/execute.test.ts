import { describe, expect, it } from "vitest";
import { replay } from "@entroworld/puzzle-engine";
import type { PuzzleDefinition } from "@entroworld/robot-api";
import { execute } from "./execute";

const corridor: PuzzleDefinition = {
  width: 5,
  height: 1,
  tiles: [".B..."],
  start: { x: 0, y: 0, dir: "E" },
  goal: { reach: { x: 4, y: 0 }, collectAll: true },
  allowedApi: ["moveForward", "turnLeft", "turnRight", "pickUp", "isPathClear"],
  controls: ["repeat"],
  maxActions: 20,
  maxBlocks: null,
  par: 3,
};

describe("sandbox execute", () => {
  it("records actions that the server's replay accepts", () => {
    const r = execute("robot.moveForward(1);\nrobot.pickUp();\nrobot.moveForward(3);\n", corridor);
    expect(r.success).toBe(true);
    expect(r.actions).toEqual([{ type: "moveForward", steps: 1 }, { type: "pickUp" }, { type: "moveForward", steps: 3 }]);
    expect(replay(corridor, r.actions).success).toBe(true);
  });

  it("runs loops and sensors", () => {
    const r = execute("robot.moveForward(1); robot.pickUp(); while (robot.isPathClear()) robot.moveForward(1);", corridor);
    expect(r.success).toBe(true);
    expect(r.actions).toHaveLength(5);
  });

  it("stops at the first blocked move and keeps it in the log", () => {
    const r = execute("robot.turnLeft(); robot.moveForward(1); robot.moveForward(1);", corridor);
    expect(r.success).toBe(false);
    expect(r.failureReason).toBe("blocked");
    expect(r.actions).toHaveLength(2);
    expect(replay(corridor, r.actions).failureReason).toBe("blocked");
  });

  it("reports goal_not_reached and too_many_actions", () => {
    expect(execute("robot.moveForward(1);", corridor).failureReason).toBe("goal_not_reached");
    const r = execute("for (;;) robot.turnLeft();", corridor);
    expect(r.failureReason).toBe("too_many_actions");
    expect(r.actions).toHaveLength(corridor.maxActions + 1);
  });

  it("turns program mistakes into readable errors", () => {
    expect(execute("robot.moveForward(0);", corridor).error).toMatch(/whole number/);
    expect(execute("robot.jump();", corridor).failureReason).toBe("invalid_action");
    expect(execute("robot.sensor('front');", corridor).error).toMatch(/isn't available/);
    expect(execute("robot.fly();", corridor).error).toMatch(/TypeError/);
    expect(execute("robot.moveForward(", corridor).error).toMatch(/SyntaxError/);
  });

  it("hides network and messaging globals from user code", () => {
    for (const name of ["fetch", "self", "globalThis", "postMessage", "XMLHttpRequest"]) {
      const r = execute(`if (typeof ${name} !== "undefined") robot.moveForward(1);`, corridor);
      expect(r.actions, name).toEqual([]);
    }
  });
});
