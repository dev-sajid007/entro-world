import { PuzzleSim, type RobotState, type SimEvent } from "@entroworld/puzzle-engine";
import {
  MAX_ACTION_LOG,
  MAX_SAY_LENGTH,
  MAX_STEPS_PER_MOVE,
  type AttemptFailureReason,
  type PuzzleDefinition,
  type RobotAction,
  type SensorDirection,
} from "@entroworld/robot-api";

export interface ExecuteResult {
  /** The action log to send to the server (it replays it to decide success). */
  actions: RobotAction[];
  events: SimEvent[];
  success: boolean;
  failureReason?: AttemptFailureReason;
  /** A mistake in the program itself (bad argument, a typo in code mode), shown to the learner. */
  error?: string;
  final: RobotState;
}

/** Thrown inside user code to stop it once the simulation has failed. */
class StopRun {}

/** Thrown for mistakes the learner can fix; the message is shown as-is. */
class ProgramError extends Error {}

/**
 * Names user code must not see. The worker has no DOM or tokens, but it shares the page's origin,
 * so network and storage APIs are hidden too. (The worker also removes them from its global scope.)
 */
export const SHADOWED_GLOBALS = [
  "self",
  "globalThis",
  "postMessage",
  "close",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "EventSource",
  "importScripts",
  "indexedDB",
  "caches",
  "Worker",
  "SharedWorker",
  "BroadcastChannel",
  "navigator",
  "location",
  "setTimeout",
  "setInterval",
  "queueMicrotask",
] as const;

/**
 * Runs a learner's program against the deterministic puzzle simulation and records every robot
 * action. Infinite loops are not handled here: the caller runs this in a Web Worker and terminates
 * it after a time limit.
 */
export function execute(code: string, puzzle: PuzzleDefinition): ExecuteResult {
  const sim = new PuzzleSim(puzzle);
  const actions: RobotAction[] = [];

  const act = (action: RobotAction) => {
    // The failing action stays in the log so the server's replay fails the same way.
    if (actions.length >= MAX_ACTION_LOG) throw new StopRun();
    actions.push(action);
    if (!sim.apply(action)) throw new StopRun();
  };
  const sensor = (method: "isPathClear" | "sensor") => {
    if (!sim.can(method)) throw new ProgramError(`robot.${method}() isn't available in this puzzle.`);
  };

  const robot = Object.freeze({
    moveForward(steps: unknown = 1) {
      if (typeof steps !== "number" || !Number.isInteger(steps) || steps < 1 || steps > MAX_STEPS_PER_MOVE) {
        throw new ProgramError(`moveForward needs a whole number of steps from 1 to ${MAX_STEPS_PER_MOVE}.`);
      }
      act({ type: "moveForward", steps });
    },
    turnLeft: () => act({ type: "turnLeft" }),
    turnRight: () => act({ type: "turnRight" }),
    jump: () => act({ type: "jump" }),
    pickUp: () => act({ type: "pickUp" }),
    drop: () => act({ type: "drop" }),
    say: (text: unknown) => act({ type: "say", text: String(text).slice(0, MAX_SAY_LENGTH) }),
    isPathClear() {
      sensor("isPathClear");
      return sim.isPathClear();
    },
    sensor(direction: unknown = "front") {
      sensor("sensor");
      if (direction !== "front" && direction !== "left" && direction !== "right") {
        throw new ProgramError('sensor() takes "front", "left" or "right".');
      }
      return sim.sense(direction as SensorDirection);
    },
  });

  let error: string | undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const program = new Function("robot", ...SHADOWED_GLOBALS, `"use strict";\n${code}`) as (...args: unknown[]) => unknown;
    program(robot);
  } catch (e) {
    if (e instanceof ProgramError) error = e.message;
    else if (!(e instanceof StopRun)) error = e instanceof Error ? `${e.name}: ${e.message}` : "Your program stopped with an error.";
  }

  const result: ExecuteResult = { actions, events: sim.events, success: false, final: sim.state };
  if (error) result.error = error;
  if (sim.failure) result.failureReason = sim.failure;
  else if (!error && sim.goalReached()) result.success = true;
  else if (!error) result.failureReason = "goal_not_reached";
  return result;
}
