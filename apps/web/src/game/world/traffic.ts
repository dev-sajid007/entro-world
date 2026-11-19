/**
 * Ambient city traffic. Decorative and client-side only: the game server knows nothing about cars
 * and they never block anyone. Cars follow closed loops on the street grid (right-hand traffic)
 * and take their starting positions from the clock, so every player sees roughly the same traffic.
 * Each car brakes for people on the road and for the car in front.
 */

export interface Point {
  x: number;
  z: number;
}

/** Lane center distance from the road's center line (roads are 10 m wide, two lanes). */
export const LANE_OFFSET = 2.5;
/** How far before a corner the turn starts (m). */
const TURN_RADIUS = 5;
const TURN_SAMPLES = 8;

/**
 * Closed loops along road center lines, as corner points in driving order. Every edge runs on a
 * road (see the street grid in world-assets: x = ±80, ±160; z = -80, 0, 80 outside the plaza and park).
 */
export const TRAFFIC_LOOPS: { corners: Point[]; cars: number; speed: number }[] = [
  // Four city blocks, west and east of the center (no cars right now; raise `cars` to add some).
  { corners: [{ x: -160, z: -80 }, { x: -80, z: -80 }, { x: -80, z: 0 }, { x: -160, z: 0 }], cars: 0, speed: 9 },
  { corners: [{ x: -160, z: 0 }, { x: -80, z: 0 }, { x: -80, z: 80 }, { x: -160, z: 80 }], cars: 0, speed: 9 },
  { corners: [{ x: 80, z: -80 }, { x: 160, z: -80 }, { x: 160, z: 0 }, { x: 80, z: 0 }], cars: 0, speed: 9 },
  { corners: [{ x: 80, z: 0 }, { x: 160, z: 0 }, { x: 160, z: 80 }, { x: 80, z: 80 }], cars: 0, speed: 9 },
  // A long tour through the middle of the city along z = 0, both ways.
  {
    corners: [
      { x: -160, z: -80 },
      { x: -160, z: 80 },
      { x: -80, z: 80 },
      { x: -80, z: 0 },
      { x: 80, z: 0 },
      { x: 80, z: 80 },
      { x: 160, z: 80 },
      { x: 160, z: -80 },
      { x: 80, z: -80 },
      { x: 80, z: 0 },
      { x: -80, z: 0 },
      { x: -80, z: -80 },
    ],
    cars: 3,
    speed: 11,
  },
];

/** The car's right side when driving in direction (dx, dz) (y up, cars face +z at heading 0). */
const right = (dx: number, dz: number): Point => ({ x: -dz, z: dx });

function unit(a: Point, b: Point): Point {
  const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  return { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
}

/** A sampled closed path with cumulative lengths, for constant-speed lookup. */
export class TrafficPath {
  readonly points: Point[];
  /** Distance along the path at each point; the last entry is the full loop length. */
  readonly distances: number[];

  constructor(corners: readonly Point[]) {
    const n = corners.length;
    // Shift every corner into the right-hand lane of both streets that meet there.
    const lane = corners.map((c, i) => {
      const prev = corners[(i - 1 + n) % n]!;
      const next = corners[(i + 1) % n]!;
      const din = unit(prev, c);
      const dout = unit(c, next);
      const rin = right(din.x, din.z);
      const rout = right(dout.x, dout.z);
      const straight = Math.abs(din.x * dout.x + din.z * dout.z) > 0.999;
      return straight ? { x: c.x + rin.x * LANE_OFFSET, z: c.z + rin.z * LANE_OFFSET } : { x: c.x + (rin.x + rout.x) * LANE_OFFSET, z: c.z + (rin.z + rout.z) * LANE_OFFSET };
    });
    // Round every turn with a quadratic curve through the corner.
    const points: Point[] = [];
    lane.forEach((c, i) => {
      const prev = lane[(i - 1 + n) % n]!;
      const next = lane[(i + 1) % n]!;
      const din = unit(prev, c);
      const dout = unit(c, next);
      if (Math.abs(din.x * dout.x + din.z * dout.z) > 0.999) {
        points.push(c);
        return;
      }
      const a = { x: c.x - din.x * TURN_RADIUS, z: c.z - din.z * TURN_RADIUS };
      const b = { x: c.x + dout.x * TURN_RADIUS, z: c.z + dout.z * TURN_RADIUS };
      for (let k = 0; k <= TURN_SAMPLES; k++) {
        const t = k / TURN_SAMPLES;
        const u = 1 - t;
        points.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, z: u * u * a.z + 2 * u * t * c.z + t * t * b.z });
      }
    });
    points.push(points[0]!);
    this.points = points;
    this.distances = [0];
    for (let i = 1; i < points.length; i++) {
      this.distances.push(this.distances[i - 1]! + Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z));
    }
  }

  get length(): number {
    return this.distances[this.distances.length - 1]!;
  }

  /** Position and heading (radians, 0 = facing +z) at distance `s` along the loop (wraps). */
  sample(s: number): { x: number; z: number; heading: number } {
    const L = this.length;
    const d = ((s % L) + L) % L;
    // Binary search for the segment containing d.
    let lo = 0;
    let hi = this.distances.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.distances[mid]! <= d) lo = mid;
      else hi = mid;
    }
    const a = this.points[lo]!;
    const b = this.points[hi]!;
    const span = this.distances[hi]! - this.distances[lo]! || 1;
    const t = (d - this.distances[lo]!) / span;
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, heading: Math.atan2(b.x - a.x, b.z - a.z) };
  }
}

export interface Car {
  id: number;
  path: TrafficPath;
  /** Distance along the path. */
  s: number;
  cruise: number;
  speed: number;
  x: number;
  z: number;
  heading: number;
  /** Half the car's length and width (m); the renderer sets them from the car's model. */
  halfLength: number;
  halfWidth: number;
  /** Sideways shift from the lane centre (m, + = towards the kerb), used to drive around people. */
  lateral: number;
  /** Seconds this car has been held up by a person on the road (0 when not). */
  waitingForPerson: number;
}

/** Gap a car keeps in front of its bumper (m), and its margin on each side. */
const LOOK_AHEAD = 8;
const SIDE_MARGIN = 0.45;
/** People are about this wide around their centre (the character's capsule plus a little). */
const PERSON_RADIUS = 0.4;
const ACCEL = 4;
const BRAKE = 12;

/** Creates the city's cars, placed from the clock (seconds) so all clients agree at start. */
export function createTraffic(nowSeconds: number, loops: readonly { corners: Point[]; cars: number; speed: number }[] = TRAFFIC_LOOPS): Car[] {
  const cars: Car[] = [];
  for (const loop of loops) {
    const path = new TrafficPath(loop.corners);
    for (let i = 0; i < loop.cars; i++) {
      const s = nowSeconds * loop.speed + (i / loop.cars) * path.length;
      const p = path.sample(s);
      cars.push({ id: cars.length, path, s, cruise: loop.speed, speed: loop.speed, halfLength: 2.35, halfWidth: 0.95, lateral: 0, waitingForPerson: 0, ...p });
    }
  }
  return cars;
}

/** `p` in the car's frame: distance forward of its centre and to its side. */
function local(car: Car, p: Point): { forward: number; side: number } {
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const dx = p.x - car.x;
  const dz = p.z - car.z;
  return { forward: dx * fx + dz * fz, side: dx * fz - dz * fx };
}

/** The outline of a car's body: corners, bumper middles and the centre. */
function bodyPoints(car: Car): Point[] {
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const points: Point[] = [];
  for (const f of [-car.halfLength, 0, car.halfLength]) {
    for (const w of [-car.halfWidth, 0, car.halfWidth]) points.push({ x: car.x + fx * f + fz * w, z: car.z + fz * f - fx * w });
  }
  return points;
}

/** True when `p` is in the space the car is about to drive into (or under the car itself). */
function inPath(car: Car, p: Point, margin: number): boolean {
  const { forward, side } = local(car, p);
  return forward > -car.halfLength - margin && forward < car.halfLength + LOOK_AHEAD && Math.abs(side) < car.halfWidth + margin;
}

/** True when any part of `other`'s body is in front of `car` (within its look-ahead). */
function sees(car: Car, other: Car): boolean {
  return bodyPoints(other).some((p) => {
    const { forward, side } = local(car, p);
    return forward > 0 && forward < car.halfLength + LOOK_AHEAD && Math.abs(side) < car.halfWidth + SIDE_MARGIN;
  });
}

/** How far a car may move off its lane centre: towards the kerb, and over the centre line. */
const MAX_TO_KERB = 5 - LANE_OFFSET - 1.1;
const MAX_TO_CENTRE = 2.0;
/** Space kept between a car's side and a person it passes (m). */
const PASSING_GAP = 0.35;
/** Sideways speed while moving around someone (m/s), and the speed to pass them at. */
const SWERVE_RATE = 1.8;
const PASSING_SPEED = 0.65;

/**
 * The sideways position (from the lane centre) that clears everyone in `sides` (their sideways
 * positions from the lane centre), closest to where the car is now; null if there's none.
 */
function clearLateral(car: Car, sides: number[]): number | null {
  const clearance = car.halfWidth + PERSON_RADIUS + PASSING_GAP;
  const candidates = [0, ...sides.flatMap((sd) => [sd + clearance, sd - clearance])].filter(
    (l) => l <= MAX_TO_KERB && l >= -MAX_TO_CENTRE && sides.every((sd) => Math.abs(l - sd) >= clearance - 1e-6),
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => Math.abs(a - car.lateral) - Math.abs(b - car.lateral) || Math.abs(a) - Math.abs(b));
  return candidates[0]!;
}

/**
 * Advances every car by `dt` seconds.
 *
 * People: a car drives around anyone on the road ahead (moving towards the kerb, or a little over
 * the centre line) without stopping. It only stops when someone is right in front of its bumper
 * and it can't get past, and it never moves while someone stands under it.
 *
 * Cars: a car stops for any car whose body is in front of it. Only when two cars are each in
 * front of the other (meeting at a crossing) does the lower id go first, so they can never wait
 * for each other forever.
 */
export function stepTraffic(cars: Car[], people: readonly Point[], dt: number): void {
  const plans = cars.map((car) => {
    // People near the car's lane ahead, measured from the lane centre (not the car's current shift).
    const lane = car.path.sample(car.s);
    const fx = Math.sin(lane.heading);
    const fz = Math.cos(lane.heading);
    const reach = car.halfLength + LOOK_AHEAD + 4;
    const sides: number[] = [];
    let close = false;
    for (const p of people) {
      const dx = p.x - lane.x;
      const dz = p.z - lane.z;
      const forward = dx * fx + dz * fz;
      if (forward < -car.halfLength - PERSON_RADIUS || forward > reach) continue;
      // Positive towards the kerb (the car's right).
      const side = dz * fx - dx * fz;
      if (Math.abs(side) > MAX_TO_KERB + car.halfWidth + PERSON_RADIUS + PASSING_GAP + 0.5) continue;
      sides.push(side);
      // In the car's way right now (with its current shift), close to or under it.
      const here = local(car, p);
      if (Math.abs(here.side) < car.halfWidth + PERSON_RADIUS && here.forward > -car.halfLength - PERSON_RADIUS && here.forward < car.halfLength + PERSON_RADIUS + 1.2) close = true;
    }
    const lateral = sides.length > 0 ? clearLateral(car, sides) : 0;
    let blockedByCar = false;
    for (const other of cars) {
      if (other === car || !sees(car, other)) continue;
      if (sees(other, car) && car.id < other.id) continue;
      blockedByCar = true;
      break;
    }
    return { lateral, close, aroundPerson: sides.length > 0, blockedByCar };
  });

  cars.forEach((car, i) => {
    const plan = plans[i]!;
    const stuck = plan.close || plan.lateral === null;
    car.waitingForPerson = plan.aroundPerson ? car.waitingForPerson + dt : 0;
    if (plan.close) car.speed = 0;
    const target = stuck || plan.blockedByCar ? 0 : plan.aroundPerson ? car.cruise * PASSING_SPEED : car.cruise;
    car.speed = car.speed < target ? Math.min(target, car.speed + ACCEL * dt) : Math.max(target, car.speed - BRAKE * dt);
    // Move sideways only while rolling (cars don't slide), back to the lane centre once clear.
    const wanted = plan.lateral ?? car.lateral;
    const rate = SWERVE_RATE * Math.min(1, car.speed / 3) * dt;
    const before = car.lateral;
    car.lateral += Math.max(-rate, Math.min(rate, wanted - car.lateral));
    const ds = car.speed * dt;
    car.s += ds;
    const p = car.path.sample(car.s);
    // The car's right (towards the kerb).
    const rx = -Math.cos(p.heading);
    const rz = Math.sin(p.heading);
    car.x = p.x + rx * car.lateral;
    car.z = p.z + rz * car.lateral;
    // Point the car the way it's actually going while it shifts sideways.
    car.heading = p.heading - (ds > 1e-6 ? Math.atan2(car.lateral - before, ds) : 0);
  });
}

/**
 * Keeps a person out of the cars: given where they are and the direction they want to walk (unit
 * vector), returns the direction to walk instead. Walking into a car's side turns into sliding along
 * it; walking straight at it stops (returns zero). Someone already inside a car's outline (a car
 * arrived while they stood there) may only walk out.
 */
export function avoidCars(cars: readonly Car[], x: number, z: number, dir: Point, reach = 0.3): Point {
  let d = { ...dir };
  for (const car of cars) {
    const hl = car.halfLength + PERSON_RADIUS;
    const hw = car.halfWidth + PERSON_RADIUS;
    const next = local(car, { x: x + d.x * reach, z: z + d.z * reach });
    if (Math.abs(next.forward) >= hl || Math.abs(next.side) >= hw) continue;
    // The face of the car the person is nearest to, as an outward normal in car space.
    const here = local(car, { x, z });
    const byLength = hl - Math.abs(here.forward);
    const bySide = hw - Math.abs(here.side);
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    const n = bySide < byLength ? { x: fz * Math.sign(here.side || 1), z: -fx * Math.sign(here.side || 1) } : { x: fx * Math.sign(here.forward || 1), z: fz * Math.sign(here.forward || 1) };
    const into = d.x * n.x + d.z * n.z;
    if (into >= 0) continue;
    // Remove the part of the step that goes into the car; keep the rest as a slide.
    const tx = d.x - into * n.x;
    const tz = d.z - into * n.z;
    const len = Math.hypot(tx, tz);
    if (len < 0.35) return { x: 0, z: 0 };
    d = { x: tx / len, z: tz / len };
  }
  return d;
}
