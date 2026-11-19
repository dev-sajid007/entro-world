import { replay } from "@entroworld/puzzle-engine";
import {
  BATTLE_COUNTDOWN_MS,
  type BattleVerdictPayload,
  type BattleView,
  type PuzzleDefinition,
  type RobotAction,
  type SessionKind,
  type SessionProgramPayload,
  type SessionStateView,
} from "@entroworld/robot-api";

export interface SessionMember {
  userId: string;
  displayName: string;
  connected: boolean;
  ready: boolean;
  attempts: number;
  solved: boolean;
  actionCount: number | null;
  timeMs: number | null;
}

export type SessionResult<T = void> = { ok: true; value: T } | { ok: false; code: string; message: string };

const ok = <T>(value: T): SessionResult<T> => ({ ok: true, value });
const fail = (code: string, message: string): SessionResult<never> => ({ ok: false, code, message });

/**
 * The rules of one Academy session, without any networking (the room wraps this).
 *
 * - **Pair programming:** one driver edits, the partner (navigator) follows live. The driver can
 *   hand over the keyboard. Runs are shared as action logs, never as code.
 * - **Coding battle:** both players get ready, a countdown starts the race, and each submission's
 *   action log is replayed here against the lesson's puzzle. The first verified solve wins.
 */
export class AcademySession {
  readonly members: SessionMember[];
  driverId: string;
  program: SessionProgramPayload | null = null;
  private phase: BattleView["phase"] = "waiting";
  private startsAt: number | null = null;
  private winnerId: string | null = null;

  constructor(
    readonly sessionId: string,
    readonly kind: SessionKind,
    readonly lesson: { id: string; title: string; puzzle: PuzzleDefinition },
    /** Host first. */
    memberIds: readonly [string, string],
    private readonly now: () => number = Date.now,
  ) {
    this.members = memberIds.map((userId) => ({ userId, displayName: "", connected: false, ready: false, attempts: 0, solved: false, actionCount: null, timeMs: null }));
    this.driverId = memberIds[0];
  }

  member(userId: string): SessionMember | undefined {
    return this.members.find((m) => m.userId === userId);
  }

  connect(userId: string, displayName: string): void {
    const m = this.member(userId);
    if (!m) return;
    m.connected = true;
    m.displayName = displayName;
  }

  disconnect(userId: string): void {
    const m = this.member(userId);
    if (!m) return;
    m.connected = false;
    // A countdown can't finish with someone gone; go back to the lobby.
    if (this.kind === "battle" && this.phase === "countdown") this.toLobby();
  }

  // -----------------------------------------------------------------------------------------------
  // Pair programming
  // -----------------------------------------------------------------------------------------------

  edit(userId: string, program: string): SessionResult<SessionProgramPayload> {
    if (this.kind !== "pair") return fail("wrong_kind", "This is not a pair session.");
    if (userId !== this.driverId) return fail("not_driver", "Your partner has the keyboard. Ask them to pass it to you.");
    this.program = { program, version: (this.program?.version ?? 0) + 1, by: userId };
    return ok(this.program);
  }

  swap(userId: string): SessionResult {
    if (this.kind !== "pair") return fail("wrong_kind", "This is not a pair session.");
    if (userId !== this.driverId) return fail("not_driver", "Only the driver can pass the keyboard.");
    const other = this.members.find((m) => m.userId !== userId)!;
    if (!other.connected) return fail("partner_away", "Your partner isn't here right now.");
    this.driverId = other.userId;
    return ok(undefined);
  }

  run(userId: string): SessionResult {
    if (this.kind !== "pair") return fail("wrong_kind", "This is not a pair session.");
    if (userId !== this.driverId) return fail("not_driver", "Only the driver can run the program.");
    return ok(undefined);
  }

  // -----------------------------------------------------------------------------------------------
  // Coding battle
  // -----------------------------------------------------------------------------------------------

  /** Marks the player ready; returns true when this starts the countdown. */
  ready(userId: string): SessionResult<boolean> {
    if (this.kind !== "battle") return fail("wrong_kind", "This is not a battle.");
    if (this.phase !== "waiting") return fail("not_waiting", "The race has already started.");
    const m = this.member(userId)!;
    m.ready = true;
    if (this.members.every((p) => p.ready && p.connected)) {
      this.phase = "countdown";
      this.startsAt = this.now() + BATTLE_COUNTDOWN_MS;
      return ok(true);
    }
    return ok(false);
  }

  /** Called when the countdown timer fires. */
  startRace(): boolean {
    if (this.phase !== "countdown") return false;
    this.phase = "racing";
    return true;
  }

  submit(userId: string, actions: readonly RobotAction[]): SessionResult<BattleVerdictPayload> {
    if (this.kind !== "battle") return fail("wrong_kind", "This is not a battle.");
    // The phase (not the clock) decides: the start timer may fire a few ms either side of startsAt.
    if (this.phase === "waiting" || this.phase === "countdown") {
      return fail("not_started", "The race hasn't started yet.");
    }
    const m = this.member(userId)!;
    // The verdict comes from replaying the log, never from the client.
    const result = replay(this.lesson.puzzle, actions);
    m.attempts++;
    let won = false;
    if (result.success && !m.solved) {
      m.solved = true;
      m.actionCount = result.actionCount;
      m.timeMs = Math.max(0, this.now() - (this.startsAt ?? this.now()));
      if (this.phase === "racing" && this.winnerId === null) {
        this.winnerId = userId;
        this.phase = "finished";
        won = true;
      }
    }
    return ok({ success: result.success, failureReason: result.failureReason ?? null, actionCount: result.actionCount, won });
  }

  rematch(): SessionResult {
    if (this.kind !== "battle") return fail("wrong_kind", "This is not a battle.");
    if (this.phase !== "finished") return fail("not_finished", "Finish this race first.");
    this.toLobby();
    for (const m of this.members) Object.assign(m, { attempts: 0, solved: false, actionCount: null, timeMs: null });
    return ok(undefined);
  }

  private toLobby(): void {
    this.phase = "waiting";
    this.startsAt = null;
    this.winnerId = null;
    for (const m of this.members) m.ready = false;
  }

  view(): SessionStateView {
    return {
      sessionId: this.sessionId,
      kind: this.kind,
      lesson: { id: this.lesson.id, title: this.lesson.title },
      members: this.members.map((m) => ({ userId: m.userId, displayName: m.displayName, connected: m.connected })),
      driverId: this.kind === "pair" ? this.driverId : null,
      battle:
        this.kind === "battle"
          ? {
              phase: this.phase,
              startsAt: this.startsAt,
              winnerId: this.winnerId,
              players: this.members.map((m) => ({
                userId: m.userId,
                ready: m.ready,
                attempts: m.attempts,
                solved: m.solved,
                actionCount: m.actionCount,
                timeMs: m.timeMs,
              })),
            }
          : null,
    };
  }
}
