import type { PuzzleDefinition } from "@entroworld/robot-api";
import type { ExecuteResult } from "./execute";

/** How long a program may run before it is stopped. Puzzle programs finish in milliseconds. */
export const RUN_TIME_LIMIT_MS = 2000;
/** How long the worker may take to load before the run is given up. */
const STARTUP_LIMIT_MS = 20_000;

export type RunResult = ({ kind: "finished" } & ExecuteResult) | { kind: "timeout" } | { kind: "crashed"; message: string };

type WorkerMessage = { type: "ready" } | { type: "result"; result: ExecuteResult };

/**
 * Runs a program in a fresh Web Worker. The worker is stopped {@link RUN_TIME_LIMIT_MS} after it
 * receives the code, so an endless loop ends the run instead of hanging the page.
 */
export function runProgram(code: string, puzzle: PuzzleDefinition): Promise<RunResult> {
  return new Promise((resolve) => {
    const worker = new Worker(new URL("./sandbox.worker.ts", import.meta.url), { type: "module" });
    let timer = setTimeout(() => finish({ kind: "crashed", message: "The code sandbox did not start." }), STARTUP_LIMIT_MS);
    const finish = (result: RunResult) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(result);
    };
    worker.onmessage = (e: MessageEvent<WorkerMessage>) => {
      if (e.data.type === "ready") {
        clearTimeout(timer);
        timer = setTimeout(() => finish({ kind: "timeout" }), RUN_TIME_LIMIT_MS);
        worker.postMessage({ code, puzzle });
      } else {
        finish({ kind: "finished", ...e.data.result });
      }
    };
    worker.onerror = (e) => {
      e.preventDefault();
      finish({ kind: "crashed", message: e.message || "The code sandbox stopped unexpectedly." });
    };
  });
}
