import { describe, expect, it } from "vitest";
import { describeBoard } from "./describe";

describe("describeBoard", () => {
  it("draws the robot, the exit and the goal", () => {
    const text = describeBoard({
      width: 3,
      height: 2,
      tiles: ["..B", "#.."],
      start: { x: 0, y: 0, dir: "E" },
      goal: { reach: { x: 2, y: 1 }, collectAll: true },
      allowedApi: ["moveForward"],
      controls: [],
      maxActions: 10,
      maxBlocks: null,
      par: null,
    });
    expect(text.split("\n").slice(0, 2)).toEqual(["R.B", "#.E"]);
    expect(text).toContain("facing right (east)");
    expect(text).toContain("end on the exit door at column 2, row 1 and pick up all 1 batteries");
  });
});
