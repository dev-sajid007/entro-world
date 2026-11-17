import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PhysicsWorld, SIM } from "@entroworld/game-engine";
import { Buttons, type InputFrame } from "@entroworld/game-protocol";
import { getCityLayout } from "@entroworld/world-assets";
import { MAX_QUEUED_FRAMES, PlayerSimulation } from "./PlayerSimulation";

let physics: PhysicsWorld;
const bounds = getCityLayout().bounds;
const SPAWN = { x: 7, y: 0, z: -52 };

beforeAll(async () => {
  physics = await PhysicsWorld.create();
});
afterAll(() => physics.dispose());

const frames = (count: number, buttons: number, startSeq = 1, yaw = 0): InputFrame[] =>
  Array.from({ length: count }, (_, i) => ({ seq: startSeq + i, buttons, yaw }));

/** Settles a fresh character on the ground (idle steps run once the input budget is saturated). */
function grounded(): PlayerSimulation {
  const sim = PlayerSimulation.spawn(physics, SPAWN.x, SPAWN.y + 0.5, SPAWN.z, 0);
  for (let i = 0; i < 40 && !sim.state.grounded; i++) sim.tick(0.05, bounds);
  expect(sim.state.grounded).toBe(true);
  return sim;
}

describe("PlayerSimulation", () => {
  it("applies queued inputs and acknowledges the last sequence", () => {
    const sim = grounded();
    sim.enqueue(frames(30, Buttons.Forward));
    let steps = 0;
    for (let i = 0; i < 20 && sim.queued > 0; i++) steps += sim.tick(0.05, bounds).steps;
    expect(steps).toBe(30);
    expect(sim.lastSeq).toBe(30);
    // Forward at yaw 0 walks towards -Z at walking speed.
    expect(SPAWN.z - sim.state.z).toBeCloseTo(SIM.walkSpeed * 30 * SIM.dt, 0);
    sim.dispose();
  });

  it("never simulates faster than real time, however many inputs arrive", () => {
    const sim = grounded();
    const start = { x: sim.state.x, z: sim.state.z };
    // Two seconds of sprinting delivered at once.
    const result = sim.enqueue(frames(120, Buttons.Forward | Buttons.Sprint));
    expect(result.accepted).toBe(MAX_QUEUED_FRAMES);
    expect(result.rejected).toBe(120 - MAX_QUEUED_FRAMES);

    // 0.2 s of wall-clock time may consume at most the banked credit (<= 0.3 s) plus 0.2 s.
    const credit = sim.budget.available;
    expect(credit).toBeLessThanOrEqual(0.3 + 1e-6);
    let simulated = 0;
    for (let i = 0; i < 4; i++) simulated += sim.tick(0.05, bounds).steps * SIM.dt;
    expect(simulated).toBeLessThanOrEqual(credit + 0.2 + 1e-6);
    const moved = Math.hypot(sim.state.x - start.x, sim.state.z - start.z);
    expect(moved).toBeLessThanOrEqual(SIM.runSpeed * (credit + 0.2 + SIM.dt));
    // The rest of the flood is still queued, not simulated.
    expect(sim.queued).toBeGreaterThan(0);
    sim.dispose();
  });

  it("drops replayed and out-of-order frames", () => {
    const sim = grounded();
    expect(sim.enqueue(frames(5, 0, 10)).accepted).toBe(5);
    expect(sim.enqueue(frames(3, Buttons.Forward, 13))).toEqual({ accepted: 1, rejected: 2 });
    expect(sim.enqueue([{ seq: 3, buttons: Buttons.Forward, yaw: 0 }])).toEqual({ accepted: 0, rejected: 1 });
    sim.dispose();
  });

  it("acknowledges but ignores inputs while locked (seated or transferring)", () => {
    const sim = grounded();
    const before = { ...sim.character.snapshot() };
    sim.locked = true;
    sim.enqueue(frames(20, Buttons.Forward | Buttons.Sprint));
    sim.tick(0.05, bounds);
    expect(sim.lastSeq).toBe(20);
    expect(sim.state.x).toBe(before.x);
    expect(sim.state.z).toBe(before.z);
    sim.dispose();
  });

  it("keeps falling when the client stops sending inputs", () => {
    const sim = PlayerSimulation.spawn(physics, SPAWN.x, 6, SPAWN.z, 0);
    // Budget starts unsaturated: nothing happens until ~0.3 s of silence.
    for (let i = 0; i < 30; i++) sim.tick(0.05, bounds);
    expect(sim.state.grounded).toBe(true);
    expect(sim.state.y).toBeLessThan(0.1);
    sim.dispose();
  });

  it("reports a respawn when the character leaves the world", () => {
    const sim = grounded();
    sim.teleport(SPAWN.x, SIM.killPlaneY - 1, SPAWN.z, 0);
    sim.enqueue(frames(1, 0, 1));
    expect(sim.tick(0.05, bounds).respawn).toBe(true);
    sim.dispose();
  });
});
