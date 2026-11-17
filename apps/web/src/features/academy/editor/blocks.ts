import * as Blockly from "blockly/core";
import * as En from "blockly/msg/en";
import { javascriptGenerator } from "blockly/javascript";
import { MAX_SAY_LENGTH, MAX_STEPS_PER_MOVE, type PuzzleDefinition } from "@entroworld/robot-api";

/**
 * Robot blocks for the Academy (SPEC-ADDENDUM-01 §3.3). Each block compiles to one robot API call;
 * the generated JavaScript runs in the sandbox worker, never on the main thread.
 */

export const START_BLOCK = "robot_start";
const MAX_REPEAT = 20;

const ROBOT_COLOUR = "#0284c7";
const LOOP_COLOUR = "#7c3aed";

let registered = false;

/** Defines the blocks and their code generators (once per page). */
export function registerRobotBlocks(): void {
  if (registered) return;
  registered = true;
  Blockly.setLocale(En as unknown as Record<string, string>);

  Blockly.common.defineBlocksWithJsonArray([
    {
      type: START_BLOCK,
      message0: "when ▶ Run is pressed",
      nextStatement: null,
      colour: "#16a34a",
      tooltip: "Your program starts here. Snap blocks underneath.",
      hat: "cap",
    },
    {
      type: "robot_move",
      message0: "move forward %1",
      args0: [{ type: "field_number", name: "STEPS", value: 1, min: 1, max: MAX_STEPS_PER_MOVE, precision: 1 }],
      previousStatement: null,
      nextStatement: null,
      colour: ROBOT_COLOUR,
      tooltip: "Drive forward this many tiles.",
    },
    {
      type: "robot_turn",
      message0: "turn %1",
      args0: [
        {
          type: "field_dropdown",
          name: "DIR",
          options: [
            ["left ↺", "Left"],
            ["right ↻", "Right"],
          ],
        },
      ],
      previousStatement: null,
      nextStatement: null,
      colour: ROBOT_COLOUR,
      tooltip: "Turn a quarter turn on the spot.",
    },
    { type: "robot_jump", message0: "jump", previousStatement: null, nextStatement: null, colour: ROBOT_COLOUR, tooltip: "Hop over one tile, like a gap." },
    { type: "robot_pickup", message0: "pick up battery", previousStatement: null, nextStatement: null, colour: ROBOT_COLOUR, tooltip: "Pick up the battery on this tile." },
    { type: "robot_drop", message0: "drop battery", previousStatement: null, nextStatement: null, colour: ROBOT_COLOUR, tooltip: "Put a battery down here." },
    {
      type: "robot_say",
      message0: "say %1",
      args0: [{ type: "field_input", name: "TEXT", text: "Hello!" }],
      previousStatement: null,
      nextStatement: null,
      colour: ROBOT_COLOUR,
      tooltip: "Show a speech bubble.",
    },
    {
      type: "robot_repeat",
      message0: "repeat %1 times",
      args0: [{ type: "field_number", name: "TIMES", value: 2, min: 1, max: MAX_REPEAT, precision: 1 }],
      message1: "%1",
      args1: [{ type: "input_statement", name: "DO" }],
      previousStatement: null,
      nextStatement: null,
      colour: LOOP_COLOUR,
      tooltip: "Run the blocks inside again and again.",
    },
  ]);

  const g = javascriptGenerator;
  g.forBlock[START_BLOCK] = () => "";
  g.forBlock.robot_move = (b) => `robot.moveForward(${clampInt(b.getFieldValue("STEPS"), 1, MAX_STEPS_PER_MOVE)});\n`;
  g.forBlock.robot_turn = (b) => `robot.turn${b.getFieldValue("DIR") === "Left" ? "Left" : "Right"}();\n`;
  g.forBlock.robot_jump = () => "robot.jump();\n";
  g.forBlock.robot_pickup = () => "robot.pickUp();\n";
  g.forBlock.robot_drop = () => "robot.drop();\n";
  g.forBlock.robot_say = (b) => `robot.say(${JSON.stringify(String(b.getFieldValue("TEXT")).slice(0, MAX_SAY_LENGTH))});\n`;
  g.forBlock.robot_repeat = (b, gen) => {
    const times = clampInt(b.getFieldValue("TIMES"), 1, MAX_REPEAT);
    const i = gen.nameDB_!.getDistinctName("i", Blockly.Names.NameType.VARIABLE);
    return `for (let ${i} = 0; ${i} < ${times}; ${i}++) {\n${gen.statementToCode(b, "DO")}}\n`;
  };
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

/** The blocks a puzzle offers, in toolbox order. */
export function toolboxFor(puzzle: PuzzleDefinition): Blockly.utils.toolbox.ToolboxInfo {
  const api = new Set(puzzle.allowedApi);
  const kinds: string[] = [];
  if (api.has("moveForward")) kinds.push("robot_move");
  if (api.has("turnLeft") || api.has("turnRight")) kinds.push("robot_turn");
  if (api.has("jump")) kinds.push("robot_jump");
  if (api.has("pickUp")) kinds.push("robot_pickup");
  if (api.has("drop")) kinds.push("robot_drop");
  if (api.has("say")) kinds.push("robot_say");
  if (puzzle.controls.includes("repeat")) kinds.push("robot_repeat");
  return { kind: "flyoutToolbox", contents: kinds.map((type) => ({ kind: "block", type })) };
}

/** The program as JavaScript: only blocks attached under the start block run. */
export function workspaceCode(ws: Blockly.Workspace): string {
  return javascriptGenerator.workspaceToCode(ws);
}

/** Program blocks in the workspace (the start block and disconnected blocks don't count). */
export function countBlocks(ws: Blockly.Workspace): number {
  return ws.getAllBlocks(false).filter((b) => b.type !== START_BLOCK && b.isEnabled()).length;
}
