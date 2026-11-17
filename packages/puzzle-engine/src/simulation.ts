import {
  DIRECTIONS,
  type AttemptFailureReason,
  type Direction,
  type PuzzleDefinition,
  type RobotAction,
  type RobotMethod,
  type SensorDirection,
  type SensorReading,
} from "@entroworld/robot-api";

/**
 * Deterministic robot puzzle simulation (SPEC-ADDENDUM-01 §4.4), shared by the browser sandbox and
 * the API. The sandbox runs user code against it to produce an action log; the server replays that
 * log here to decide success. It only depends on the puzzle definition and the actions: no clocks,
 * no randomness, no floating point.
 */

export interface RobotState {
  x: number;
  y: number;
  dir: Direction;
  /** Batteries the robot is carrying. */
  carrying: number;
}

/** What happened, step by step, for the client to animate. */
export type SimEvent =
  | { type: "move"; x: number; y: number }
  | { type: "jump"; x: number; y: number }
  | { type: "turn"; dir: Direction }
  | { type: "pickUp"; x: number; y: number; ok: boolean }
  | { type: "drop"; x: number; y: number; ok: boolean }
  | { type: "say"; text: string }
  /** The robot tried to enter `x, y` and could not: the run stops here. */
  | { type: "blocked"; x: number; y: number; cause: "wall" | "gap" | "edge" };

const STEP: Record<Direction, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const turn = (dir: Direction, by: 1 | -1): Direction => DIRECTIONS[(DIRECTIONS.indexOf(dir) + by + 4) % 4]!;
const key = (x: number, y: number) => `${x},${y}`;

export class PuzzleSim {
  private robot: RobotState;
  /** Cells that currently hold a battery. */
  private readonly batteries = new Set<string>();
  private readonly allowed: ReadonlySet<RobotMethod>;
  readonly events: SimEvent[] = [];
  actionCount = 0;
  /** Set when the run has failed; no further actions apply. */
  failure: AttemptFailureReason | null = null;

  constructor(readonly puzzle: PuzzleDefinition) {
    this.robot = { x: puzzle.start.x, y: puzzle.start.y, dir: puzzle.start.dir, carrying: 0 };
    puzzle.tiles.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === "B") this.batteries.add(key(x, y));
    });
    this.allowed = new Set(puzzle.allowedApi);
  }

  get state(): Readonly<RobotState> {
    return { ...this.robot };
  }

  /** Cells holding a battery, as `[x, y]` pairs in row-major order. */
  batteryCells(): [number, number][] {
    return [...this.batteries].map((k) => k.split(",").map(Number) as [number, number]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  }

  can(method: RobotMethod): boolean {
    return this.allowed.has(method);
  }

  private tile(x: number, y: number): string | null {
    if (x < 0 || y < 0 || x >= this.puzzle.width || y >= this.puzzle.height) return null;
    return this.puzzle.tiles[y]![x]!;
  }

  private ahead(distance: number, dir = this.robot.dir): [number, number] {
    const [dx, dy] = STEP[dir];
    return [this.robot.x + dx * distance, this.robot.y + dy * distance];
  }

  private fail(reason: AttemptFailureReason): false {
    this.failure = reason;
    return false;
  }

  /**
   * Applies one action. Returns false when the run fails (the robot is blocked, the action is not
   * allowed in this puzzle, or the action budget is exceeded); the simulation then stops.
   */
  apply(action: RobotAction): boolean {
    if (this.failure) return false;
    if (!this.allowed.has(action.type)) return this.fail("invalid_action");
    if (this.actionCount >= this.puzzle.maxActions) return this.fail("too_many_actions");
    this.actionCount++;
    const r = this.robot;
    switch (action.type) {
      case "moveForward":
        for (let i = 0; i < action.steps; i++) {
          const [x, y] = this.ahead(1);
          const t = this.tile(x, y);
          if (t === null || t === "#" || t === "~") {
            this.events.push({ type: "blocked", x, y, cause: t === null ? "edge" : t === "#" ? "wall" : "gap" });
            return this.fail("blocked");
          }
          r.x = x;
          r.y = y;
          this.events.push({ type: "move", x, y });
        }
        return true;
      case "jump": {
        // Hop over one tile (floor or gap, not a wall) and land two tiles ahead.
        const [mx, my] = this.ahead(1);
        const [x, y] = this.ahead(2);
        const over = this.tile(mx, my);
        const land = this.tile(x, y);
        if (over === null || over === "#") {
          this.events.push({ type: "blocked", x: mx, y: my, cause: over === null ? "edge" : "wall" });
          return this.fail("blocked");
        }
        if (land === null || land === "#" || land === "~") {
          this.events.push({ type: "blocked", x, y, cause: land === null ? "edge" : land === "#" ? "wall" : "gap" });
          return this.fail("blocked");
        }
        r.x = x;
        r.y = y;
        this.events.push({ type: "jump", x, y });
        return true;
      }
      case "turnLeft":
      case "turnRight":
        r.dir = turn(r.dir, action.type === "turnLeft" ? -1 : 1);
        this.events.push({ type: "turn", dir: r.dir });
        return true;
      case "pickUp": {
        const ok = this.batteries.delete(key(r.x, r.y));
        if (ok) r.carrying++;
        this.events.push({ type: "pickUp", x: r.x, y: r.y, ok });
        return true;
      }
      case "drop": {
        const ok = r.carrying > 0 && !this.batteries.has(key(r.x, r.y));
        if (ok) {
          r.carrying--;
          this.batteries.add(key(r.x, r.y));
        }
        this.events.push({ type: "drop", x: r.x, y: r.y, ok });
        return true;
      }
      case "say":
        this.events.push({ type: "say", text: action.text });
        return true;
    }
  }

  /** What is in the neighboring tile in a direction relative to the robot. */
  sense(direction: SensorDirection): SensorReading {
    const dir = direction === "front" ? this.robot.dir : turn(this.robot.dir, direction === "left" ? -1 : 1);
    const [x, y] = this.ahead(1, dir);
    const t = this.tile(x, y);
    if (t === null || t === "#" || t === "~") return "wall";
    return this.batteries.has(key(x, y)) ? "item" : "empty";
  }

  isPathClear(): boolean {
    return this.sense("front") !== "wall";
  }

  /** The goal is checked when the program has finished, not mid-run. */
  goalReached(): boolean {
    const { reach, collectAll } = this.puzzle.goal;
    if (reach && (this.robot.x !== reach.x || this.robot.y !== reach.y)) return false;
    if (collectAll && this.batteries.size > 0) return false;
    return true;
  }
}

export interface ReplayResult {
  success: boolean;
  failureReason?: AttemptFailureReason;
  actionCount: number;
  final: RobotState;
  events: SimEvent[];
}

/** Replays an action log from the puzzle's start state. This is the server's source of truth. */
export function replay(puzzle: PuzzleDefinition, actions: readonly RobotAction[]): ReplayResult {
  const sim = new PuzzleSim(puzzle);
  if (actions.length > puzzle.maxActions) {
    return { success: false, failureReason: "too_many_actions", actionCount: actions.length, final: sim.state, events: [] };
  }
  for (const action of actions) if (!sim.apply(action)) break;
  const result: ReplayResult = { success: false, actionCount: actions.length, final: sim.state, events: sim.events };
  if (sim.failure) result.failureReason = sim.failure;
  else if (sim.goalReached()) result.success = true;
  else result.failureReason = "goal_not_reached";
  return result;
}
