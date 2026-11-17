import { beforeAll, describe, expect, it } from "vitest";
import { Buttons } from "@entroworld/game-protocol";
import { getCityLayout } from "@entroworld/world-assets";
import { InputBudget, PhysicsWorld, PredictedCharacter, SIM, groundTiles, validateStep, sanitizeYaw } from "./index";

let physics: PhysicsWorld;

beforeAll(async () => {
  physics = await PhysicsWorld.create();
});

const run = (steps: number, fn: () => void) => {
  for (let i = 0; i < steps; i++) fn();
};

describe("PhysicsWorld", () => {
  it("loads every layout collider plus the ground", () => {
    expect(physics.colliderCount).toBe(getCityLayout().colliders.length + groundTiles(getCityLayout()).length);
  });

  it("has ground under the whole map, including AI Agent Street's shop counters", () => {
    const layout = getCityLayout();
    const { minX, maxX, minZ, maxZ } = layout.bounds;
    const inset = 0.5;
    const points: [number, number][] = [
      [minX + inset, minZ + inset],
      [minX + inset, maxZ - inset],
      [maxX - inset, minZ + inset],
      [maxX - inset, maxZ - inset],
    ];
    for (const shop of layout.shops) points.push([shop.trigger.x, shop.trigger.z], [shop.keeper.x, shop.keeper.z]);
    for (const [x, z] of points) expect(physics.groundHeight(x, z), `no ground at ${x}, ${z}`).not.toBeNull();
  });

  it("keeps a customer standing at the Code Corner counter", () => {
    const shop = getCityLayout().shops.find((s) => s.slug === "code-corner")!;
    const c = physics.createCharacter(shop.trigger.x, 0.5, shop.trigger.z);
    run(180, () => physics.stepCharacter(c, 0, 0));
    expect(c.state.grounded).toBe(true);
    expect(c.state.y).toBeGreaterThan(-0.05);
    physics.removeCharacter(c);
  });

  it("drops a character onto the ground and keeps it there", () => {
    const c = physics.createCharacter(0, 3, -50);
    let minY = Infinity;
    run(300, () => {
      physics.stepCharacter(c, 0, 0);
      minY = Math.min(minY, c.state.y);
    });
    expect(c.state.grounded).toBe(true);
    expect(minY).toBeGreaterThan(-0.01);
    expect(c.state.y).toBeLessThan(0.05);
    // Walking across ground tile seams keeps the character on the surface.
    run(600, () => {
      physics.stepCharacter(c, Buttons.Right | Buttons.Sprint, 0);
      minY = Math.min(minY, c.state.y);
    });
    expect(minY).toBeGreaterThan(-0.01);
    physics.removeCharacter(c);
  });

  it("walks relative to the camera yaw at walking speed", () => {
    const c = physics.createCharacter(0, 0, -50);
    run(10, () => physics.stepCharacter(c, 0, 0));
    const startZ = c.state.z;
    run(60, () => physics.stepCharacter(c, Buttons.Forward, 0));
    expect(startZ - c.state.z).toBeCloseTo(SIM.walkSpeed, 1);
    const startX = c.state.x;
    // Yaw of +90 degrees turns "forward" toward -X.
    run(30, () => physics.stepCharacter(c, Buttons.Forward | Buttons.Sprint, Math.PI / 2));
    expect(startX - c.state.x).toBeCloseTo(SIM.runSpeed / 2, 1);
    physics.removeCharacter(c);
  });

  it("cannot walk through a building", () => {
    const b = getCityLayout().buildings.find((x) => x.zoneId === "zone-business" && x.rotation === 0)!;
    const startZ = b.z + b.depth / 2 + 3;
    const c = physics.createCharacter(b.x, 0, startZ);
    run(10, () => physics.stepCharacter(c, 0, 0));
    run(600, () => physics.stepCharacter(c, Buttons.Forward | Buttons.Sprint, 0));
    expect(c.state.z).toBeGreaterThan(b.z + b.depth / 2);
    physics.removeCharacter(c);
  });

  it("jumps and lands", () => {
    const c = physics.createCharacter(0, 0, -50);
    run(10, () => physics.stepCharacter(c, 0, 0));
    physics.stepCharacter(c, Buttons.Jump, 0);
    let maxY = 0;
    run(90, () => {
      physics.stepCharacter(c, 0, 0);
      maxY = Math.max(maxY, c.state.y);
    });
    expect(maxY).toBeGreaterThan(1.2);
    expect(c.state.grounded).toBe(true);
    expect(c.state.y).toBeLessThan(0.1);
    physics.removeCharacter(c);
  });

  it("characters do not collide with each other", () => {
    const a = physics.createCharacter(0, 0, -50);
    const b = physics.createCharacter(0, 0, -51);
    run(10, () => {
      physics.stepCharacter(a, 0, 0);
      physics.stepCharacter(b, 0, 0);
    });
    run(30, () => physics.stepCharacter(a, Buttons.Forward, 0));
    expect(a.state.z).toBeLessThan(-51.5);
    physics.removeCharacter(a);
    physics.removeCharacter(b);
  });

  it("is deterministic across independent worlds", async () => {
    const other = await PhysicsWorld.create();
    const a = physics.createCharacter(10, 0, -40);
    const b = other.createCharacter(10, 0, -40);
    const inputs = Array.from({ length: 400 }, (_, i) => ({
      buttons: (i % 50 < 30 ? Buttons.Forward : Buttons.Left) | (i % 90 === 0 ? Buttons.Jump : 0) | (i > 200 ? Buttons.Sprint : 0),
      yaw: Math.sin(i / 40),
    }));
    for (const f of inputs) {
      physics.stepCharacter(a, f.buttons, f.yaw);
      other.stepCharacter(b, f.buttons, f.yaw);
    }
    expect(b.state).toEqual(a.state);
    physics.removeCharacter(a);
    other.dispose();
  });
});

describe("PredictedCharacter", () => {
  it("reconciles to the server and replays unacknowledged inputs", async () => {
    const server = await PhysicsWorld.create();
    const serverChar = server.createCharacter(0, 0, -50);
    const clientChar = physics.createCharacter(0, 0, -50);
    const predicted = new PredictedCharacter(physics, clientChar);
    const frames = [];
    for (let i = 0; i < 30; i++) frames.push(predicted.applyInput(Buttons.Forward, 0.3));
    // Server has processed the first 20 frames.
    for (const f of frames.slice(0, 20)) server.stepCharacter(serverChar, f.buttons, f.yaw);
    const predictedZ = clientChar.state.z;
    const correction = predicted.reconcile({ ...serverChar.snapshot(), seq: frames[19]!.seq });
    expect(predicted.pendingCount).toBe(10);
    expect(Math.abs(correction.dz)).toBeLessThan(1e-6);
    expect(clientChar.state.z).toBeCloseTo(predictedZ, 6);
    // A server-side correction (e.g. server says we were blocked) moves the client.
    const moved = predicted.reconcile({ ...serverChar.snapshot(), z: serverChar.state.z + 2, seq: frames[19]!.seq });
    expect(moved.dz).toBeCloseTo(2, 3);
    physics.removeCharacter(clientChar);
    server.dispose();
  });
});

describe("InputBudget", () => {
  it("allows real-time input rates and rejects floods", () => {
    const budget = new InputBudget(0.3, 0);
    let accepted = 0;
    for (let tick = 0; tick < 20; tick++) {
      budget.accrue(0.05);
      // A cheating client sends 10 frames per 50 ms tick (3.3x real time).
      for (let i = 0; i < 10; i++) if (budget.tryConsume(SIM.dt)) accepted++;
    }
    // One second of real time allows ~60 frames.
    expect(accepted).toBeGreaterThanOrEqual(59);
    expect(accepted).toBeLessThanOrEqual(61);
  });
});

describe("validateStep", () => {
  const bounds = getCityLayout().bounds;
  const base = { x: 0, y: 0, z: 0, vy: 0, grounded: true, facing: 0 };
  it("accepts normal movement and rejects teleports", () => {
    expect(validateStep(base, { ...base, x: 0.1 }, bounds)).toBe("ok");
    expect(validateStep(base, { ...base, x: 5 }, bounds)).toBe("too_fast");
    expect(validateStep(base, { ...base, y: 10 }, bounds)).toBe("too_fast");
    expect(validateStep(base, { ...base, y: -40 }, bounds)).toBe("fell_out");
    expect(validateStep(base, { ...base, x: Number.NaN }, bounds)).toBe("invalid");
    expect(validateStep({ ...base, x: 300 }, { ...base, x: 300.1 }, bounds)).toBe("out_of_bounds");
  });
  it("sanitizes yaw", () => {
    expect(sanitizeYaw(Number.POSITIVE_INFINITY)).toBe(0);
    expect(sanitizeYaw(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
  });
});
