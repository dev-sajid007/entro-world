import { describe, expect, it } from "vitest";
import { BATTLE_COUNTDOWN_MS, type PuzzleDefinition, type RobotAction } from "@entroworld/robot-api";
import { AcademySession } from "./academySession";

const puzzle: PuzzleDefinition = {
  width: 4,
  height: 1,
  tiles: ["...."],
  start: { x: 0, y: 0, dir: "E" },
  goal: { reach: { x: 3, y: 0 }, collectAll: false },
  allowedApi: ["moveForward", "turnLeft", "turnRight"],
  controls: [],
  maxActions: 10,
  maxBlocks: null,
  par: null,
};
const HOST = "00000000-0000-4000-8000-000000000001";
const GUEST = "00000000-0000-4000-8000-000000000002";
const solve: RobotAction[] = [{ type: "moveForward", steps: 3 }];
const miss: RobotAction[] = [{ type: "moveForward", steps: 1 }];

function session(kind: "pair" | "battle", clock = { t: 1_000 }) {
  const s = new AcademySession("s1", kind, { id: "l1", title: "Hello robot", puzzle }, [HOST, GUEST], () => clock.t);
  s.connect(HOST, "Host");
  s.connect(GUEST, "Guest");
  return s;
}

describe("AcademySession: pair programming", () => {
  it("only lets the driver edit and run, and versions every edit", () => {
    const s = session("pair");
    expect(s.driverId).toBe(HOST);
    expect(s.edit(GUEST, "{}")).toMatchObject({ ok: false, code: "not_driver" });
    expect(s.run(GUEST)).toMatchObject({ ok: false, code: "not_driver" });
    expect(s.edit(HOST, "a")).toEqual({ ok: true, value: { program: "a", version: 1, by: HOST } });
    expect(s.edit(HOST, "b")).toMatchObject({ ok: true, value: { version: 2 } });
    expect(s.run(HOST).ok).toBe(true);
  });

  it("passes the keyboard to a partner who is present", () => {
    const s = session("pair");
    s.disconnect(GUEST);
    expect(s.swap(HOST)).toMatchObject({ ok: false, code: "partner_away" });
    s.connect(GUEST, "Guest");
    expect(s.swap(GUEST)).toMatchObject({ ok: false, code: "not_driver" });
    expect(s.swap(HOST).ok).toBe(true);
    expect(s.driverId).toBe(GUEST);
    expect(s.view().driverId).toBe(GUEST);
    expect(s.edit(HOST, "x").ok).toBe(false);
    expect(s.edit(GUEST, "x").ok).toBe(true);
  });

  it("rejects battle messages", () => {
    expect(session("pair").ready(HOST).ok).toBe(false);
    expect(session("pair").submit(HOST, solve).ok).toBe(false);
  });
});

describe("AcademySession: coding battle", () => {
  it("starts the countdown only when both players are ready", () => {
    const clock = { t: 1_000 };
    const s = session("battle", clock);
    expect(s.ready(HOST)).toEqual({ ok: true, value: false });
    expect(s.view().battle?.phase).toBe("waiting");
    expect(s.ready(GUEST)).toEqual({ ok: true, value: true });
    expect(s.view().battle).toMatchObject({ phase: "countdown", startsAt: 1_000 + BATTLE_COUNTDOWN_MS });
  });

  it("refuses submissions before the start", () => {
    const clock = { t: 1_000 };
    const s = session("battle", clock);
    expect(s.submit(HOST, solve)).toMatchObject({ ok: false, code: "not_started" });
    s.ready(HOST);
    s.ready(GUEST);
    expect(s.submit(HOST, solve)).toMatchObject({ ok: false, code: "not_started" });
  });

  it("replays submissions and crowns the first verified solve", () => {
    const clock = { t: 1_000 };
    const s = session("battle", clock);
    s.ready(HOST);
    s.ready(GUEST);
    clock.t += BATTLE_COUNTDOWN_MS;
    expect(s.startRace()).toBe(true);

    clock.t += 4_000;
    expect(s.submit(GUEST, miss)).toMatchObject({ ok: true, value: { success: false, failureReason: "goal_not_reached", won: false } });
    expect(s.submit(HOST, solve)).toEqual({ ok: true, value: { success: true, failureReason: null, actionCount: 1, won: true } });
    // Solving after the winner still counts as solved, but doesn't win.
    expect(s.submit(GUEST, solve)).toMatchObject({ ok: true, value: { success: true, won: false } });

    const battle = s.view().battle!;
    expect(battle.phase).toBe("finished");
    expect(battle.winnerId).toBe(HOST);
    expect(battle.players.find((p) => p.userId === HOST)).toMatchObject({ solved: true, attempts: 1, actionCount: 1, timeMs: 4_000 });
    expect(battle.players.find((p) => p.userId === GUEST)).toMatchObject({ solved: true, attempts: 2 });
  });

  it("goes back to the lobby when someone leaves during the countdown, and supports rematches", () => {
    const clock = { t: 1_000 };
    const s = session("battle", clock);
    s.ready(HOST);
    s.ready(GUEST);
    s.disconnect(GUEST);
    expect(s.view().battle).toMatchObject({ phase: "waiting", startsAt: null });
    expect(s.startRace()).toBe(false);
    expect(s.rematch()).toMatchObject({ ok: false, code: "not_finished" });

    s.connect(GUEST, "Guest");
    s.ready(HOST);
    s.ready(GUEST);
    clock.t += BATTLE_COUNTDOWN_MS;
    s.startRace();
    s.submit(GUEST, solve);
    expect(s.rematch().ok).toBe(true);
    expect(s.view().battle).toMatchObject({ phase: "waiting", winnerId: null });
    expect(s.view().battle!.players.every((p) => !p.ready && p.attempts === 0 && !p.solved)).toBe(true);
  });
});
