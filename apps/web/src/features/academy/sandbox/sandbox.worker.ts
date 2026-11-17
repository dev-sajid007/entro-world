/// <reference lib="webworker" />
import type { PuzzleDefinition } from "@entroworld/robot-api";
import { SHADOWED_GLOBALS, execute } from "./execute";

/**
 * The code sandbox (SPEC-ADDENDUM-01 §4.2). One worker runs one program and is then thrown away;
 * the page terminates it if it runs past the time limit, so an endless loop never freezes the UI.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
const post = scope.postMessage.bind(scope);

// Remove network, storage and messaging APIs before any user code exists in this worker.
for (const name of SHADOWED_GLOBALS) {
  if (name === "self" || name === "globalThis") continue;
  try {
    Object.defineProperty(scope, name, { value: undefined, writable: false, configurable: false });
  } catch {
    // Not configurable in this browser; user code still sees it shadowed by `execute`.
  }
}

scope.onmessage = (e: MessageEvent<{ code: string; puzzle: PuzzleDefinition }>) => {
  scope.onmessage = null;
  post({ type: "result", result: execute(e.data.code, e.data.puzzle) });
};
// Loading the worker can take a while (first run, dev server); the run's clock starts after this.
post({ type: "ready" });
