import * as Blockly from "blockly/core";
// Registers Blockly's built-in blocks; the Academy uses its function (procedure) blocks.
import "blockly/blocks";
import * as En from "blockly/msg/en";
import { javascriptGenerator } from "blockly/javascript";
import { SHADOWED_GLOBALS } from "@entroworld/puzzle-engine";
import { MAX_SAY_LENGTH, MAX_STEPS_PER_MOVE, type PuzzleDefinition } from "@entroworld/robot-api";

/**
 * Robot blocks for the Academy (SPEC-ADDENDUM-01 §3.3). Each block compiles to one robot API call;
 * the generated JavaScript runs in the sandbox worker, never on the main thread.
 */

export const START_BLOCK = "robot_start";
export const FUNCTION_DEF_BLOCK = "procedures_defnoreturn";
const FUNCTION_CALL_BLOCK = "procedures_callnoreturn";
const MAX_REPEAT = 20;

const ROBOT_COLOUR = "#0284c7";
const LOOP_COLOUR = "#7c3aed";
const LOGIC_COLOUR = "#d97706";

/** What the condition blocks can test, as [label, value] dropdown options. */
const CONDITIONS: [string, string][] = [
  ["path ahead is clear", "FRONT_CLEAR"],
  ["path to the left is clear", "LEFT_CLEAR"],
  ["path to the right is clear", "RIGHT_CLEAR"],
  ["battery ahead", "BATTERY_AHEAD"],
];
const CONDITION_CODE: Record<string, string> = {
  FRONT_CLEAR: 'robot.sensor("front") !== "wall"',
  LEFT_CLEAR: 'robot.sensor("left") !== "wall"',
  RIGHT_CLEAR: 'robot.sensor("right") !== "wall"',
  BATTERY_AHEAD: 'robot.sensor("front") === "item"',
};

let registered = false;

/** Defines the blocks and their code generators (once per page). */
export function registerRobotBlocks(): void {
  if (registered) return;
  registered = true;
  Blockly.setLocale(En as unknown as Record<string, string>);
  // Kid-friendly wording for the built-in function blocks, and no "describe this function" note.
  Blockly.Msg.PROCEDURES_DEFNORETURN_TITLE = "define";
  Blockly.Msg.PROCEDURES_DEFNORETURN_PROCEDURE = "my moves";
  Blockly.Msg.PROCEDURES_DEFNORETURN_COMMENT = "";
  Blockly.Msg.PROCEDURES_DEFNORETURN_TOOLTIP = "Build your own block: name it, then put moves inside.";
  Blockly.Msg.PROCEDURES_CALLNORETURN_TOOLTIP = "Run the moves of your function.";
  // Function names must not shadow the robot or the sandbox's hidden globals.
  javascriptGenerator.addReservedWords(["robot", ...SHADOWED_GLOBALS].join(","));

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
    {
      type: "robot_until",
      message0: "repeat until at the exit",
      message1: "%1",
      args1: [{ type: "input_statement", name: "DO" }],
      previousStatement: null,
      nextStatement: null,
      colour: LOOP_COLOUR,
      tooltip: "Run the blocks inside again and again, until the robot stands on the exit door.",
    },
    {
      type: "robot_if",
      message0: "if %1",
      args0: [{ type: "field_dropdown", name: "COND", options: CONDITIONS }],
      message1: "%1",
      args1: [{ type: "input_statement", name: "DO" }],
      previousStatement: null,
      nextStatement: null,
      colour: LOGIC_COLOUR,
      tooltip: "Run the blocks inside only when the robot's sensor says so.",
    },
    {
      type: "robot_if_else",
      message0: "if %1",
      args0: [{ type: "field_dropdown", name: "COND", options: CONDITIONS }],
      message1: "%1",
      args1: [{ type: "input_statement", name: "DO" }],
      message2: "else %1",
      args2: [{ type: "input_statement", name: "ELSE" }],
      previousStatement: null,
      nextStatement: null,
      colour: LOGIC_COLOUR,
      tooltip: "Run the first blocks when the sensor says so, otherwise the blocks under \"else\".",
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
  g.forBlock.robot_until = (b, gen) => `while (!robot.atExit()) {\n${gen.statementToCode(b, "DO")}}\n`;
  g.forBlock.robot_if = (b, gen) => `if (${conditionCode(b)}) {\n${gen.statementToCode(b, "DO")}}\n`;
  g.forBlock.robot_if_else = (b, gen) => {
    // Nested "if … else" in the else branch reads as a plain "else if" chain.
    const only = b.getInputTargetBlock("ELSE");
    if (only && !only.getNextBlock() && only.type === "robot_if_else" && only.isEnabled()) {
      return `if (${conditionCode(b)}) {\n${gen.statementToCode(b, "DO")}} else ${gen.blockToCode(only) as string}`;
    }
    return `if (${conditionCode(b)}) {\n${gen.statementToCode(b, "DO")}} else {\n${gen.statementToCode(b, "ELSE")}}\n`;
  };
}

function conditionCode(b: Blockly.Block): string {
  return CONDITION_CODE[String(b.getFieldValue("COND"))] ?? "false";
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

/** A function defined in the workspace, as its call block needs it. */
export interface FunctionSignature {
  name: string;
  params: string[];
}

/** Functions defined in the workspace, in creation order. */
export function definedFunctions(ws: Blockly.Workspace): FunctionSignature[] {
  return ws.getBlocksByType(FUNCTION_DEF_BLOCK, false).map((b) => {
    const [name, params] = (b as unknown as { getProcedureDef(): [string, string[], boolean] }).getProcedureDef();
    return { name, params };
  });
}

/** The blocks a puzzle offers, in toolbox order, plus a call block for each defined function. */
export function toolboxFor(puzzle: PuzzleDefinition, functions: readonly FunctionSignature[] = []): Blockly.utils.toolbox.ToolboxInfo {
  const api = new Set(puzzle.allowedApi);
  const kinds: string[] = [];
  if (api.has("moveForward")) kinds.push("robot_move");
  if (api.has("turnLeft") || api.has("turnRight")) kinds.push("robot_turn");
  if (api.has("jump")) kinds.push("robot_jump");
  if (api.has("pickUp")) kinds.push("robot_pickup");
  if (api.has("drop")) kinds.push("robot_drop");
  if (api.has("say")) kinds.push("robot_say");
  if (puzzle.controls.includes("repeat")) kinds.push("robot_repeat");
  if (puzzle.controls.includes("until")) kinds.push("robot_until");
  if (puzzle.controls.includes("if")) kinds.push("robot_if", "robot_if_else");
  const contents: Blockly.utils.toolbox.ToolboxItemInfo[] = kinds.map((type) => ({ kind: "block", type }));
  if (puzzle.controls.includes("function")) {
    contents.push({ kind: "block", type: FUNCTION_DEF_BLOCK });
    for (const f of functions) contents.push({ kind: "block", type: FUNCTION_CALL_BLOCK, extraState: { name: f.name, params: f.params } });
  }
  return { kind: "flyoutToolbox", contents };
}

/** The program as JavaScript: only blocks attached under the start block run. */
export function workspaceCode(ws: Blockly.Workspace): string {
  return javascriptGenerator.workspaceToCode(ws);
}

/** Program blocks in the workspace (the start block and disconnected blocks don't count). */
export function countBlocks(ws: Blockly.Workspace): number {
  return ws.getAllBlocks(false).filter((b) => b.type !== START_BLOCK && b.isEnabled()).length;
}
