import { InputBudget, SIM, deriveAnimation, sanitizeYaw, validateStep, type Character, type MovementVerdict, type PhysicsWorld } from "@entroworld/game-engine";
import { AnimCode, Buttons, type InputFrame } from "@entroworld/game-protocol";
import type { Rect } from "@entroworld/shared";

/** At most this much unprocessed input (seconds of simulation) may be queued per player. */
export const MAX_QUEUED_FRAMES = 30;
/** Upper bound on simulation steps per player per server tick (protects the tick budget). */
export const MAX_STEPS_PER_TICK = 20;

const MOVE_BUTTONS = Buttons.Forward | Buttons.Backward | Buttons.Left | Buttons.Right | Buttons.Jump;

export interface EnqueueResult {
  accepted: number;
  /** Frames dropped as replays, out-of-order or over the queue limit. */
  rejected: number;
}

export interface TickResult {
  steps: number;
  /** Steps whose outcome failed validation and were reverted (or respawned). */
  rejected: number;
  respawn: boolean;
  /** True when a processed frame contained movement (used to cancel emotes). */
  moved: boolean;
}

/**
 * Authoritative movement for one player. The client only sends button/yaw frames; this class
 * applies them through the shared physics world at no more than real-time speed (InputBudget),
 * validates each step, and tracks the last applied sequence for client reconciliation.
 */
export class PlayerSimulation {
  readonly budget = new InputBudget(0.3, 0.1);
  private queue: InputFrame[] = [];
  private lastQueuedSeq = 0;
  /** Last input sequence applied (or acknowledged while unable to move). */
  lastSeq = 0;
  /** When true (seated, transferring, dropped) inputs are acknowledged but not simulated. */
  locked = false;
  anim: number = AnimCode.IDLE;

  constructor(
    private readonly physics: PhysicsWorld,
    readonly character: Character,
  ) {}

  static spawn(physics: PhysicsWorld, x: number, y: number, z: number, facing: number): PlayerSimulation {
    return new PlayerSimulation(physics, physics.createCharacter(x, y, z, facing));
  }

  get state() {
    return this.character.state;
  }

  get queued(): number {
    return this.queue.length;
  }

  enqueue(frames: readonly InputFrame[]): EnqueueResult {
    let accepted = 0;
    let rejected = 0;
    for (const frame of frames) {
      if (frame.seq <= this.lastQueuedSeq || this.queue.length >= MAX_QUEUED_FRAMES) {
        rejected++;
        continue;
      }
      this.lastQueuedSeq = frame.seq;
      this.queue.push({ seq: frame.seq, buttons: frame.buttons, yaw: sanitizeYaw(frame.yaw) });
      accepted++;
    }
    return { accepted, rejected };
  }

  /** Advances by `dt` seconds of real time, consuming queued input within the time budget. */
  tick(dt: number, bounds: Rect): TickResult {
    const result: TickResult = { steps: 0, rejected: 0, respawn: false, moved: false };
    this.budget.accrue(dt);

    if (this.locked) {
      // Acknowledge (and discard) inputs sent before the client learned it cannot move.
      const last = this.queue.at(-1);
      if (last) this.lastSeq = Math.max(this.lastSeq, last.seq);
      this.queue = [];
      return result;
    }

    while (this.queue.length > 0 && result.steps < MAX_STEPS_PER_TICK && this.budget.tryConsume(SIM.dt)) {
      const frame = this.queue.shift()!;
      if ((frame.buttons & MOVE_BUTTONS) !== 0) result.moved = true;
      this.step(frame.buttons, frame.yaw, bounds, result);
      this.lastSeq = frame.seq;
      if (result.respawn) break;
    }

    // A client that stopped sending (backgrounded tab, stalled connection) still falls: once its
    // budget is saturated, apply idle steps for the elapsed time so nobody hangs in mid-air.
    if (this.queue.length === 0 && this.budget.saturated && !this.state.grounded && !result.respawn) {
      const idleSteps = Math.min(MAX_STEPS_PER_TICK, Math.round(dt / SIM.dt));
      for (let i = 0; i < idleSteps && !result.respawn; i++) this.step(0, 0, bounds, result);
    }

    this.anim = deriveAnimation(this.state);
    return result;
  }

  private step(buttons: number, yaw: number, bounds: Rect, result: TickResult): void {
    const before = this.character.snapshot();
    this.physics.stepCharacter(this.character, buttons, yaw, SIM.dt);
    result.steps++;
    const verdict: MovementVerdict = validateStep(before, this.character.snapshot(), bounds);
    if (verdict === "ok") return;
    result.rejected++;
    if (verdict === "fell_out" || verdict === "invalid") result.respawn = true;
    else this.character.restore(before);
  }

  /** Moves the character without simulation (spawn, seat, travel) and clears queued input. */
  teleport(x: number, y: number, z: number, facing: number): void {
    this.character.teleport(x, y, z, facing);
    this.state.grounded = false;
    this.queue = [];
  }

  dispose(): void {
    this.physics.removeCharacter(this.character);
  }
}
