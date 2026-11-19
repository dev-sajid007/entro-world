import type { SimEvent } from "@entroworld/puzzle-engine";
import type { AttemptFailureReason, PuzzleDefinition } from "@entroworld/robot-api";
import type { RunResult } from "../sandbox/runProgram";

/** A finished run in a form the session and class screens share. */
export interface RunSummary {
  success: boolean;
  failureReason?: AttemptFailureReason | undefined;
  error?: string | undefined;
  events: readonly SimEvent[];
  actionCount: number;
}

/** One friendly sentence about why a run didn't solve the puzzle. */
export function failureSentence(run: RunSummary, puzzle: PuzzleDefinition): string {
  if (run.error) return `Oops: ${run.error}`;
  switch (run.failureReason) {
    case "blocked": {
      const bump = [...run.events].reverse().find((e): e is Extract<SimEvent, { type: "blocked" }> => e.type === "blocked");
      if (bump?.cause === "gap") return "Splash! The robot can't drive over a gap.";
      if (bump?.cause === "edge") return "Careful! The robot tried to drive off the board.";
      return "Bonk! The robot drove into a wall.";
    }
    case "too_many_actions":
      return `Too many moves: this puzzle allows at most ${puzzle.maxActions}.`;
    case "invalid_action":
      return "That block can't be used in this puzzle.";
    default:
      return puzzle.goal.collectAll ? "Not there yet: reach the exit with every battery." : "The program finished, but the robot isn't on the glowing exit yet.";
  }
}

/** The message for a run that never produced an action log (endless loop, sandbox crash). */
export function abortedSentence(r: Exclude<RunResult, { kind: "finished" }>): string {
  return r.kind === "timeout" ? "Your program was stopped after 2 seconds. Is there a loop that never ends?" : r.message;
}
