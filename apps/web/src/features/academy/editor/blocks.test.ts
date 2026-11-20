import { describe, expect, it } from "vitest";
import * as Blockly from "blockly/core";
import { execute } from "@entroworld/puzzle-engine";
import type { PuzzleDefinition } from "@entroworld/robot-api";
import { FUNCTION_DEF_BLOCK, START_BLOCK, countBlocks, definedFunctions, registerRobotBlocks, toolboxFor, workspaceCode } from "./blocks";

registerRobotBlocks();

// Copies of seeded puzzles (packages/database/src/academy-seed.ts).
const MOVE_TURN = ["moveForward", "turnLeft", "turnRight"] as const;
const SENSORS = ["sensor", "isPathClear", "atExit"] as const;
const PUZZLES: Record<string, PuzzleDefinition> = {
  "hello-robot": {
    width: 5, height: 3, tiles: ["#####", ".....", "#####"], start: { x: 0, y: 1, dir: "E" }, goal: { reach: { x: 4, y: 1 }, collectAll: false },
    allowedApi: ["moveForward"], controls: [], maxActions: 10, maxBlocks: null, par: 1,
  },
  "winding-path": {
    width: 7, height: 7, tiles: ["...#...", "##.#.#.", "##...#.", "######.", "###....", "###.###", "###...."], start: { x: 0, y: 0, dir: "E" },
    goal: { reach: { x: 6, y: 6 }, collectAll: false }, allowedApi: [...MOVE_TURN, ...SENSORS], controls: ["if", "until"], maxActions: 40, maxBlocks: 6, par: 30,
  },
  "battery-alcoves": {
    width: 8, height: 2, tiles: ["#BB##B##", "........"], start: { x: 0, y: 1, dir: "E" }, goal: { reach: { x: 7, y: 1 }, collectAll: true },
    allowedApi: [...MOVE_TURN, "pickUp"], controls: ["function"], maxActions: 40, maxBlocks: 16, par: 25,
  },
  "open-the-vault": {
    width: 8, height: 8, tiles: ["..######", "#.######", "B.######", "#.......", "#.#####.", "#B###B..", "###B###.", "........"], start: { x: 0, y: 7, dir: "E" },
    goal: { reach: { x: 0, y: 0 }, collectAll: true }, allowedApi: [...MOVE_TURN, "pickUp", ...SENSORS], controls: ["repeat", "if", "until", "function"], maxActions: 120, maxBlocks: 9, par: 92,
  },
};
const lesson = (slug: string) => ({ puzzle: PUZZLES[slug]! });

type Spec = { type: string; fields?: Record<string, unknown>; inputs?: Record<string, Spec[]>; extraState?: unknown };
/** Builds a serialized block chain (each block's `next` is the following one). */
function chain(specs: Spec[]): object | undefined {
  const [first, ...rest] = specs;
  if (!first) return undefined;
  const inputs = Object.fromEntries(Object.entries(first.inputs ?? {}).map(([k, v]) => [k, { block: chain(v) }]));
  const next = chain(rest);
  return { type: first.type, fields: first.fields, inputs, extraState: first.extraState, ...(next ? { next: { block: next } } : {}) };
}
function workspace(top: Spec[][]): Blockly.Workspace {
  const ws = new Blockly.Workspace();
  Blockly.serialization.workspaces.load({ blocks: { languageVersion: 0, blocks: top.map((c, i) => ({ ...chain(c), x: 0, y: i * 400 })) } }, ws);
  return ws;
}
const move = (n: number): Spec => ({ type: "robot_move", fields: { STEPS: n } });
const turn = (dir: "Left" | "Right"): Spec => ({ type: "robot_turn", fields: { DIR: dir } });

describe("robot blocks", () => {
  it("solve the winding path with conditions inside the block limit", () => {
    const l = lesson("winding-path");
    const ws = workspace([
      [
        { type: START_BLOCK },
        {
          type: "robot_until",
          inputs: {
            DO: [
              {
                type: "robot_if_else",
                fields: { COND: "FRONT_CLEAR" },
                inputs: { DO: [move(1)], ELSE: [{ type: "robot_if_else", fields: { COND: "LEFT_CLEAR" }, inputs: { DO: [turn("Left")], ELSE: [turn("Right")] } }] },
              },
            ],
          },
        },
      ],
    ]);
    expect(countBlocks(ws)).toBeLessThanOrEqual(l.puzzle.maxBlocks!);
    const code = workspaceCode(ws);
    expect(code).toContain("} else if (");
    expect(execute(code, l.puzzle)).toMatchObject({ success: true });
  });

  it("solve the alcoves with a function and offer a call block for it", () => {
    const l = lesson("battery-alcoves");
    const grab = "grab battery";
    const call: Spec = { type: "procedures_callnoreturn", extraState: { name: grab } };
    const ws = workspace([
      [{ type: START_BLOCK }, move(1), call, move(1), call, move(3), call, move(2)],
      [
        {
          type: FUNCTION_DEF_BLOCK,
          fields: { NAME: grab },
          inputs: { STACK: [turn("Left"), move(1), { type: "robot_pickup" }, turn("Right"), turn("Right"), move(1), turn("Left")] },
        },
      ],
    ]);
    expect(countBlocks(ws)).toBeLessThanOrEqual(l.puzzle.maxBlocks!);
    expect(execute(workspaceCode(ws), l.puzzle)).toMatchObject({ success: true });
    const toolbox = toolboxFor(l.puzzle, definedFunctions(ws));
    expect(toolbox.contents.at(-1)).toMatchObject({ type: "procedures_callnoreturn", extraState: { name: grab } });
  });

  it("crack the vault with a left-hand wall follower inside the block limit", () => {
    const l = lesson("open-the-vault");
    const ws = workspace([
      [
        { type: START_BLOCK },
        {
          type: "robot_until",
          inputs: {
            DO: [
              {
                type: "robot_if_else",
                fields: { COND: "LEFT_CLEAR" },
                inputs: { DO: [turn("Left"), move(1)], ELSE: [{ type: "robot_if_else", fields: { COND: "FRONT_CLEAR" }, inputs: { DO: [move(1)], ELSE: [turn("Right")] } }] },
              },
              { type: "robot_pickup" },
            ],
          },
        },
      ],
    ]);
    expect(countBlocks(ws)).toBeLessThanOrEqual(l.puzzle.maxBlocks!);
    expect(execute(workspaceCode(ws), l.puzzle)).toMatchObject({ success: true });
  });

  it("only offers the controls a puzzle allows", () => {
    const types = (slug: string) => toolboxFor(lesson(slug).puzzle).contents.map((c) => (c as { type: string }).type);
    expect(types("hello-robot")).toEqual(["robot_move"]);
    expect(types("winding-path")).toEqual(["robot_move", "robot_turn", "robot_until", "robot_if", "robot_if_else"]);
    expect(types("open-the-vault")).toContain(FUNCTION_DEF_BLOCK);
  });
});
