import { describe, expect, it } from "vitest";
import { getCityLayout } from "@entroworld/world-assets";
import { LANE_OFFSET, TRAFFIC_LOOPS, TrafficPath, avoidCars, createTraffic, stepTraffic, type Car } from "./traffic";

/** Busy streets: every loop full of cars, to stress crossings and queues. */
const BUSY = TRAFFIC_LOOPS.map((l) => ({ ...l, cars: l.cars === 0 ? 4 : 12 }));

/** Whether two cars' bodies overlap (separating axis test on their rectangles). */
function overlap(a: Car, b: Car): boolean {
  const axes = [a.heading, a.heading + Math.PI / 2, b.heading, b.heading + Math.PI / 2].map((h) => ({ x: Math.sin(h), z: Math.cos(h) }));
  const corners = (c: Car) =>
    [-1, 1].flatMap((f) => [-1, 1].map((w) => ({ x: c.x + Math.sin(c.heading) * f * c.halfLength + Math.cos(c.heading) * w * c.halfWidth, z: c.z + Math.cos(c.heading) * f * c.halfLength - Math.sin(c.heading) * w * c.halfWidth })));
  const ca = corners(a);
  const cb = corners(b);
  return axes.every((ax) => {
    const pa = ca.map((p) => p.x * ax.x + p.z * ax.z);
    const pb = cb.map((p) => p.x * ax.x + p.z * ax.z);
    return Math.max(...pa) > Math.min(...pb) && Math.max(...pb) > Math.min(...pa);
  });
}

/** True when (x, z) is on an asphalt surface of the city layout. */
function onAsphalt(x: number, z: number): boolean {
  return getCityLayout().surfaces.some((s) => s.kind === "asphalt" && x >= s.rect.minX - 0.01 && x <= s.rect.maxX + 0.01 && z >= s.rect.minZ - 0.01 && z <= s.rect.maxZ + 0.01);
}

describe("traffic", () => {
  it("only drives on roads", () => {
    for (const loop of TRAFFIC_LOOPS) {
      const path = new TrafficPath(loop.corners);
      for (let s = 0; s < path.length; s += 1) {
        const p = path.sample(s);
        expect(onAsphalt(p.x, p.z), `(${p.x.toFixed(1)}, ${p.z.toFixed(1)})`).toBe(true);
      }
    }
  });

  it("keeps to the right-hand lane", () => {
    // The first block loop starts eastbound along z = -80: driving +x, the right side is +z.
    const path = new TrafficPath(TRAFFIC_LOOPS[0]!.corners);
    const p = path.sample(20);
    expect(p.z).toBeCloseTo(-80 + LANE_OFFSET);
    expect(p.heading).toBeCloseTo(Math.PI / 2);
  });

  it("is the same for everyone at the same moment", () => {
    const a = createTraffic(1_000);
    const b = createTraffic(1_000);
    expect(a.map((c) => [c.x, c.z])).toEqual(b.map((c) => [c.x, c.z]));
  });

  it("drives around a person in the lane without stopping or touching them", () => {
    const cars = createTraffic(0).slice(0, 1);
    const car = cars[0]!;
    car.s = 30;
    stepTraffic(cars, [], 0);
    // Someone standing in the middle of the lane, 25 m ahead.
    const person = { x: car.x + Math.sin(car.heading) * 25, z: car.z + Math.cos(car.heading) * 25 };
    const s0 = car.s;
    let minGap = Infinity;
    let minSpeed = Infinity;
    for (let i = 0; i < 30 * 6; i++) {
      stepTraffic(cars, [person], 1 / 30);
      minSpeed = Math.min(minSpeed, car.speed);
      // Distance from the person to the car's body rectangle.
      const fx = Math.sin(car.heading);
      const fz = Math.cos(car.heading);
      const dx = person.x - car.x;
      const dz = person.z - car.z;
      const f = Math.max(0, Math.abs(dx * fx + dz * fz) - car.halfLength);
      const sd = Math.max(0, Math.abs(dx * fz - dz * fx) - car.halfWidth);
      minGap = Math.min(minGap, Math.hypot(f, sd));
    }
    expect(car.s - s0).toBeGreaterThan(40);
    expect(minSpeed).toBeGreaterThan(3);
    expect(minGap).toBeGreaterThan(0.4);
    // Back in its lane afterwards.
    for (let i = 0; i < 30 * 3; i++) stepTraffic(cars, [person], 1 / 30);
    expect(car.lateral).toBeCloseTo(0);
  });

  it("never drives one car through another, even in heavy traffic", () => {
    const cars = createTraffic(777, BUSY);
    for (let step = 0; step < 20 * 120; step++) {
      stepTraffic(cars, [], 1 / 20);
      for (let i = 0; i < cars.length; i++) {
        for (let j = i + 1; j < cars.length; j++) {
          if (overlap(cars[i]!, cars[j]!)) throw new Error(`cars ${i} and ${j} overlap at step ${step} (${cars[i]!.x.toFixed(1)}, ${cars[i]!.z.toFixed(1)})`);
        }
      }
    }
    // And the traffic keeps flowing.
    expect(cars.every((c) => c.s > 0)).toBe(true);
  }, 60_000);

  it("lets people slide along a car's side but not walk into it", () => {
    const [car] = createTraffic(0).slice(0, 1);
    Object.assign(car!, { x: 0, z: 0, heading: 0, halfLength: 2.3, halfWidth: 0.95 });
    // Beside the car (on its +x side... heading 0 faces +z, so its side faces x), walking diagonally into it.
    const slide = avoidCars([car!], 1.45, 0, { x: -Math.SQRT1_2, z: Math.SQRT1_2 });
    expect(slide.x).toBeCloseTo(0);
    expect(slide.z).toBeCloseTo(1);
    // Walking straight at it stops; walking away is fine.
    expect(avoidCars([car!], 1.45, 0, { x: -1, z: 0 })).toEqual({ x: 0, z: 0 });
    expect(avoidCars([car!], 1.45, 0, { x: 1, z: 0 })).toEqual({ x: 1, z: 0 });
    // Far away nothing changes.
    expect(avoidCars([car!], 10, 10, { x: -1, z: 0 })).toEqual({ x: -1, z: 0 });
  });

  it("never rolls into someone who steps out right in front of it", () => {
    const cars = createTraffic(0).slice(0, 1);
    const car = cars[0]!;
    car.s = 40;
    stepTraffic(cars, [], 0);
    // Full speed, and a person appears 3.5 m ahead of the centre (about 1 m from the bumper).
    const person = { x: car.x + Math.sin(car.heading) * 3.5, z: car.z + Math.cos(car.heading) * 3.5 };
    for (let i = 0; i < 30; i++) stepTraffic(cars, [person], 1 / 30);
    expect(Math.hypot(person.x - car.x, person.z - car.z)).toBeGreaterThan(car.halfLength + 0.4);
  });

  it("doesn't move while someone stands under it", () => {
    const cars = createTraffic(0).slice(0, 1);
    const car = cars[0]!;
    car.s = 40;
    stepTraffic(cars, [], 0);
    car.speed = 0;
    const s0 = car.s;
    for (let i = 0; i < 60; i++) stepTraffic(cars, [{ x: car.x, z: car.z }], 1 / 30);
    expect(car.s).toBe(s0);
  });

  it("never gets stuck: every car keeps moving over time", () => {
    const cars = createTraffic(12_345, BUSY);
    const start = cars.map((c) => c.s);
    for (let i = 0; i < 20 * 120; i++) stepTraffic(cars, [], 1 / 20);
    cars.forEach((c, i) => expect(c.s - start[i]!).toBeGreaterThan(200));
  }, 60_000);
});
