import type { SimEvent } from "@entroworld/puzzle-engine";
import type { PuzzleDefinition } from "@entroworld/robot-api";
import { Store } from "../core/Store";

/** Upper bound of one event's animation (seconds), for the fallback timer. */
const MAX_EVENT_SECONDS = 1;

/** How a run ended, as far as the board animation is concerned. */
export type RunOutcome = "success" | "failure";

export interface LabRun {
  /** Increases with every run so the board restarts its animation. */
  id: number;
  events: readonly SimEvent[];
  outcome: RunOutcome;
}

export interface LabState {
  /** The puzzle on the board (null: the board shows an empty pad). */
  puzzle: PuzzleDefinition | null;
  /** Bumped to put the robot back on its start tile. */
  resetId: number;
  run: LabRun | null;
  /** Id of the last run whose animation has finished playing. */
  finishedRunId: number;
}

/**
 * The Puzzle Lab board, shared by the Academy panel (which runs programs) and the 3D scene (which
 * animates them). Local to this player: other people in the lab don't see your robot (yet).
 */
class LabStore extends Store<LabState> {
  private nextRun = 1;

  show(puzzle: PuzzleDefinition | null): void {
    this.set({ puzzle, run: null, resetId: this.get().resetId + 1 });
  }

  reset(): void {
    this.set({ run: null, resetId: this.get().resetId + 1 });
  }

  /** Starts animating a run; resolves when the board has finished playing it. */
  play(events: readonly SimEvent[], outcome: RunOutcome): Promise<void> {
    const id = this.nextRun++;
    this.set({ run: { id, events, outcome } });
    return new Promise((resolve) => {
      const end = () => {
        clearTimeout(fallback);
        off();
        resolve();
      };
      const off = this.subscribe(() => {
        const s = this.get();
        // Finished, or replaced by another run or a reset.
        if (s.finishedRunId >= id || s.run?.id !== id) end();
      });
      // If the board isn't on screen nothing animates; don't keep the learner waiting for it.
      const fallback = setTimeout(end, MAX_EVENT_SECONDS * 1000 * events.length + 4000);
    });
  }

  finish(id: number): void {
    if (id > this.get().finishedRunId) this.set({ finishedRunId: id });
  }
}

export const labStore = new LabStore({ puzzle: null, resetId: 0, run: null, finishedRunId: 0 });
