import type { InputFrame } from "@entroworld/game-protocol";
import { SIM } from "./constants";
import type { Character, CharacterSnapshot, PhysicsWorld } from "./physics";

export interface AuthoritativeState extends CharacterSnapshot {
  /** Last input sequence the server has applied. */
  seq: number;
}

/**
 * Client-side prediction with server reconciliation.
 * Inputs are applied locally immediately and kept until the server acknowledges them; when an
 * authoritative state arrives, the character is reset to it and unacknowledged inputs are replayed.
 */
export class PredictedCharacter {
  private pending: InputFrame[] = [];
  private nextSeq = 1;
  lastAckSeq = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    readonly character: Character,
    private readonly maxPending = 240,
  ) {}

  get pendingCount(): number {
    return this.pending.length;
  }

  /** Creates and applies an input frame locally. Returns the frame to send to the server. */
  applyInput(buttons: number, yaw: number): InputFrame {
    const frame: InputFrame = { seq: this.nextSeq++, buttons, yaw };
    this.physics.stepCharacter(this.character, buttons, yaw, SIM.dt);
    this.pending.push(frame);
    if (this.pending.length > this.maxPending) this.pending.shift();
    return frame;
  }

  /**
   * Reconciles with an authoritative state. Returns the positional correction (new - old) so the
   * renderer can smooth it out instead of snapping.
   */
  reconcile(server: AuthoritativeState): { dx: number; dy: number; dz: number } {
    if (server.seq < this.lastAckSeq) return { dx: 0, dy: 0, dz: 0 };
    this.lastAckSeq = server.seq;
    const before = { x: this.character.state.x, y: this.character.state.y, z: this.character.state.z };
    let drop = 0;
    while (drop < this.pending.length && this.pending[drop]!.seq <= server.seq) drop++;
    if (drop > 0) this.pending.splice(0, drop);

    this.character.restore(server);
    for (const frame of this.pending) this.physics.stepCharacter(this.character, frame.buttons, frame.yaw, SIM.dt);

    const s = this.character.state;
    return { dx: s.x - before.x, dy: s.y - before.y, dz: s.z - before.z };
  }

  /** Discards pending inputs, e.g. after a teleport or zone transfer. */
  reset(seqStart = this.nextSeq): void {
    this.pending = [];
    this.nextSeq = seqStart;
    this.lastAckSeq = seqStart - 1;
  }
}

/**
 * Server-side input rate limiter: a client may only consume as much simulation time as real time
 * has passed (plus a small buffer for network jitter). Prevents speed hacks via input flooding.
 */
export class InputBudget {
  private credit: number;

  constructor(
    private readonly maxCredit = 0.3,
    initialCredit = 0.1,
  ) {
    this.credit = initialCredit;
  }

  accrue(seconds: number): void {
    this.credit = Math.min(this.maxCredit, this.credit + seconds);
  }

  tryConsume(seconds: number): boolean {
    if (this.credit + 1e-6 < seconds) return false;
    this.credit -= seconds;
    return true;
  }

  get available(): number {
    return this.credit;
  }

  get saturated(): boolean {
    return this.credit >= this.maxCredit - 1e-6;
  }
}
