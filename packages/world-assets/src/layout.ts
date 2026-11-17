import { createRng, pick, range, type Rect, type ZoneId, ZONES } from "@entroworld/shared";
import type {
  Building,
  Chunk,
  CityLayout,
  Collider,
  InteractiveObject,
  MarketShop,
  Plot,
  Prop,
  PropKind,
  Surface,
  SurfaceKind,
  Venue,
  WaterBody,
  ZoneLayout,
} from "./types";

/**
 * Deterministic city generator. The same layout is used by the browser (rendering + client-side
 * prediction) and the game server (authoritative collision), so every value here must be derived
 * from fixed constants and the seeded PRNG only.
 */

export const LAYOUT_VERSION = 3;
export const CITY_SEED = 20_260_101;

/** The original 3x2 district grid. */
const CORE_BOUNDS: Rect = { minX: -248, maxX: 248, minZ: -168, maxZ: 168 };
/**
 * AI Agent Street: an annex west of the Business District, generated separately from the grid so
 * the rest of the city stays exactly as it was. The land south of it is sea.
 */
export const MARKET_ANNEX: Rect = { minX: -328, maxX: -248, minZ: -168, maxZ: 0 };
/** The Coding Academy campus: the annex south of AI Agent Street, west of the Residential Area. */
export const ACADEMY_ANNEX: Rect = { minX: -328, maxX: -248, minZ: 0, maxZ: 168 };
/** Walkable map bounds (with both annexes the island is a full rectangle). */
export const MAP_BOUNDS: Rect = { minX: MARKET_ANNEX.minX, maxX: CORE_BOUNDS.maxX, minZ: CORE_BOUNDS.minZ, maxZ: CORE_BOUNDS.maxZ };
/** Vertical (constant-x) and horizontal (constant-z) street lines. */
export const X_LINES = [-160, -80, 0, 80, 160] as const;
export const Z_LINES = [-80, 0, 80] as const;
const X_EDGES = [CORE_BOUNDS.minX, ...X_LINES, CORE_BOUNDS.maxX];
const Z_EDGES = [CORE_BOUNDS.minZ, ...Z_LINES, CORE_BOUNDS.maxZ];

export const ROAD_HALF_WIDTH = 5;
export const SIDEWALK_WIDTH = 3;
export const PROMENADE_WIDTH = 4;
/** The beach is walkable up to this x coordinate (shallow water beyond is blocked). */
export const SHORELINE_X = 233;

const ZONE_BOUNDS: Record<ZoneId, Rect> = {
  "zone-business": { minX: -248, maxX: -80, minZ: -168, maxZ: 0 },
  "zone-central": { minX: -80, maxX: 80, minZ: -168, maxZ: 0 },
  "zone-event": { minX: 80, maxX: 248, minZ: -168, maxZ: 0 },
  "zone-residential": { minX: -248, maxX: -80, minZ: 0, maxZ: 168 },
  "zone-park": { minX: -80, maxX: 80, minZ: 0, maxZ: 168 },
  "zone-beach": { minX: 80, maxX: 248, minZ: 0, maxZ: 168 },
  "zone-market": MARKET_ANNEX,
  "zone-academy": ACADEMY_ANNEX,
};

type LineKind = "road" | "pedestrian" | "park" | "sand";

/** Kind of the street running along a grid line at a given position along it. */
function verticalLineKind(x: number, z: number): LineKind {
  if (x === 0) return z < 0 ? "pedestrian" : "park";
  return "road";
}

function horizontalLineKind(z: number, x: number): LineKind {
  if (z === -80 && x > -80 && x < 80) return "pedestrian";
  if (z === 80 && x > -80 && x < 80) return "park";
  if (z === 80 && x > 160) return "sand";
  return "road";
}

const lineSurface: Record<LineKind, SurfaceKind> = {
  road: "asphalt",
  pedestrian: "plaza",
  park: "path",
  sand: "sand",
};

const sideSurface: Record<LineKind, SurfaceKind> = {
  road: "sidewalk",
  pedestrian: "plaza",
  park: "path",
  sand: "sand",
};

export function zoneAt(x: number, z: number): ZoneId {
  if (x < CORE_BOUNDS.minX) return z < 0 ? "zone-market" : "zone-academy";
  const col = x < -80 ? 0 : x < 80 ? 1 : 2;
  const row = z < 0 ? 0 : 1;
  const grid: ZoneId[][] = [
    ["zone-business", "zone-central", "zone-event"],
    ["zone-residential", "zone-park", "zone-beach"],
  ];
  return grid[row]![col]!;
}

export function chunkKeyAt(x: number, z: number): string {
  let iz = 0;
  while (iz < Z_EDGES.length - 2 && z >= Z_EDGES[iz + 1]!) iz++;
  if (x < CORE_BOUNDS.minX) return z < 0 ? `a0_${Math.min(iz, ANNEX_CHUNK_ROWS - 1)}` : `a1_${Math.min(Math.max(iz - ANNEX_CHUNK_ROWS, 0), ANNEX_CHUNK_ROWS - 1)}`;
  let ix = 0;
  while (ix < X_EDGES.length - 2 && x >= X_EDGES[ix + 1]!) ix++;
  return `c${ix}_${iz}`;
}

/** The annex is split into chunks along the same z lines as the grid. */
const ANNEX_CHUNK_ROWS = 2;

export function zoneBounds(zoneId: ZoneId): Rect {
  return ZONE_BOUNDS[zoneId];
}

const rotY = (lx: number, lz: number, yaw: number): [number, number] => {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [lx * c + lz * s, -lx * s + lz * c];
};

class LayoutBuilder {
  surfaces: Surface[] = [];
  buildings: Building[] = [];
  props: Prop[] = [];
  interactives: InteractiveObject[] = [];
  plots: Plot[] = [];
  venues: Venue[] = [];
  water: WaterBody[] = [];
  colliders: Collider[] = [];
  roadMarkings: CityLayout["roadMarkings"] = [];
  crosswalks: CityLayout["crosswalks"] = [];
  private counters = new Map<string, number>();

  constructor(readonly rng: () => number) {}

  nextId(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}-${n}`;
  }

  surface(kind: SurfaceKind, rect: Rect, y: number): void {
    if (rect.maxX - rect.minX <= 0.01 || rect.maxZ - rect.minZ <= 0.01) return;
    this.surfaces.push({ id: this.nextId("s"), kind, rect, y });
  }

  box(x: number, y: number, z: number, hx: number, hy: number, hz: number, rotation = 0, id?: string): void {
    this.colliders.push({ kind: "box", id: id ?? this.nextId("col"), x, y, z, hx, hy, hz, rotation });
  }

  /** Axis-aligned wall split into segments of at most 50 m (long thin boxes hurt precision). */
  wall(id: string, minX: number, maxX: number, minZ: number, maxZ: number, height: number): void {
    const alongX = maxX - minX >= maxZ - minZ;
    const length = alongX ? maxX - minX : maxZ - minZ;
    const segments = Math.max(1, Math.ceil(length / 50));
    const seg = length / segments;
    for (let i = 0; i < segments; i++) {
      const cx = alongX ? minX + seg * (i + 0.5) : (minX + maxX) / 2;
      const cz = alongX ? (minZ + maxZ) / 2 : minZ + seg * (i + 0.5);
      const hx = alongX ? seg / 2 : (maxX - minX) / 2;
      const hz = alongX ? (maxZ - minZ) / 2 : seg / 2;
      this.box(round(cx), height / 2, round(cz), round(hx), height / 2, round(hz), 0, `wall-${id}-${i}`);
    }
  }

  cylinder(x: number, y: number, z: number, radius: number, halfHeight: number): void {
    this.colliders.push({ kind: "cylinder", id: this.nextId("col"), x, y, z, radius, halfHeight });
  }

  building(b: Omit<Building, "id" | "chunk" | "zoneId">): Building {
    const building: Building = { ...b, id: this.nextId("b"), chunk: chunkKeyAt(b.x, b.z), zoneId: zoneAt(b.x, b.z) };
    this.buildings.push(building);
    const swap = Math.abs(Math.sin(b.rotation)) > 0.5;
    const hx = (swap ? b.depth : b.width) / 2;
    const hz = (swap ? b.width : b.depth) / 2;
    // Characters can never get higher than a few meters, so the collider is capped in height
    // (very tall shapes reduce shape-cast precision).
    const colliderHeight = Math.min(b.height, 16);
    this.box(b.x, colliderHeight / 2, b.z, hx, colliderHeight / 2, hz, 0, `col-${building.id}`);
    return building;
  }

  prop(kind: PropKind, x: number, z: number, rotation = 0, scale = 1, y = 0, color?: string): Prop {
    const p: Prop = { id: this.nextId(kind), kind, chunk: chunkKeyAt(x, z), x, y, z, rotation, scale, color };
    this.props.push(p);
    switch (kind) {
      case "tree":
        this.cylinder(x, 1.6, z, 0.28 * scale, 1.6);
        break;
      case "palm":
        this.cylinder(x, 2, z, 0.24 * scale, 2);
        break;
      case "lamp":
        this.cylinder(x, 3, z, 0.14, 3);
        break;
      case "statue":
        this.cylinder(x, 1.6, z, 1.6 * scale, 1.6);
        break;
      case "bench": {
        this.box(x, 0.4, z, 0.95, 0.4, 0.32, rotation);
        this.benchSeats(p, 2);
        break;
      }
      case "lounger": {
        this.box(x, 0.2, z, 0.35, 0.2, 0.95, rotation);
        this.seat(p, 0, 0);
        break;
      }
      case "picnic": {
        this.box(x, 0.4, z, 0.9, 0.4, 0.8, rotation);
        break;
      }
      case "planter":
        this.box(x, 0.45, z, 0.9, 0.45, 0.9, rotation);
        break;
      case "umbrella":
        this.cylinder(x, 1.2, z, 0.08, 1.2);
        break;
      case "lightTower":
        this.box(x, 6, z, 0.6, 6, 0.6, rotation);
        break;
      case "foodTruck": {
        const [hx, hz] = Math.abs(Math.sin(rotation)) > 0.5 ? [1.3, 3] : [3, 1.3];
        this.box(x, 1.5, z, hx, 1.5, hz, 0);
        break;
      }
      case "lifeguard":
        this.box(x, 1.6, z, 1.3, 1.6, 1.3, rotation);
        break;
      case "volleyNet":
        this.cylinder(x - 4.5, 1.2, z, 0.08, 1.2);
        this.cylinder(x + 4.5, 1.2, z, 0.08, 1.2);
        break;
      default:
        break;
    }
    return p;
  }

  private benchSeats(bench: Prop, count: number): void {
    const spacing = count === 2 ? 0.9 : 0.6;
    for (let i = 0; i < count; i++) {
      const lx = (i - (count - 1) / 2) * spacing;
      this.seat(bench, lx, -0.05, i);
    }
  }

  private seat(parent: Prop, lx: number, lz: number, index = 0): void {
    const [dx, dz] = rotY(lx, lz, parent.rotation);
    const x = parent.x + dx;
    const z = parent.z + dz;
    this.interactives.push({
      id: `seat:${parent.id}:${index}`,
      kind: "seat",
      zoneId: zoneAt(x, z),
      chunk: chunkKeyAt(x, z),
      x,
      y: parent.kind === "lounger" ? 0.35 : 0.48,
      z,
      rotation: parent.rotation,
      radius: 2.2,
      label: parent.kind === "lounger" ? "Lounger" : "Bench",
    });
  }

  interactive(o: Omit<InteractiveObject, "zoneId" | "chunk">): InteractiveObject {
    const obj: InteractiveObject = { ...o, zoneId: zoneAt(o.x, o.z), chunk: chunkKeyAt(o.x, o.z) };
    this.interactives.push(obj);
    return obj;
  }

  /** Scatter props of a kind in a rect, avoiding a list of keep-out rects. */
  scatter(
    kind: PropKind,
    rect: Rect,
    count: number,
    avoid: Rect[] = [],
    minSpacing = 4,
    scaleRange: [number, number] = [0.85, 1.25],
  ): void {
    this.scatterWith(this.rng, kind, rect, count, avoid, minSpacing, scaleRange);
  }

  scatterWith(
    rng: () => number,
    kind: PropKind,
    rect: Rect,
    count: number,
    avoid: Rect[] = [],
    minSpacing = 4,
    scaleRange: [number, number] = [0.85, 1.25],
  ): void {
    const placed: [number, number][] = [];
    let attempts = 0;
    while (placed.length < count && attempts < count * 30) {
      attempts++;
      const x = range(rng, rect.minX, rect.maxX);
      const z = range(rng, rect.minZ, rect.maxZ);
      if (avoid.some((r) => x > r.minX - 1 && x < r.maxX + 1 && z > r.minZ - 1 && z < r.maxZ + 1)) continue;
      if (placed.some(([px, pz]) => Math.hypot(px - x, pz - z) < minSpacing)) continue;
      placed.push([x, z]);
      this.prop(kind, round(x), round(z), round(rng() * Math.PI * 2), round(range(rng, ...scaleRange)));
    }
  }
}

const round = (v: number, digits = 3): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

const inset = (r: Rect, left: number, right: number, top: number, bottom: number): Rect => ({
  minX: r.minX + left,
  maxX: r.maxX - right,
  minZ: r.minZ + top,
  maxZ: r.maxZ - bottom,
});

const rectCenter = (r: Rect): [number, number] => [(r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2];

interface Cell {
  ix: number;
  iz: number;
  key: string;
  rect: Rect;
  zoneId: ZoneId;
  /** Kind of street on each side, or "edge" at the map boundary. */
  sides: { west: LineKind | "edge"; east: LineKind | "edge"; north: LineKind | "edge"; south: LineKind | "edge" };
  /** Buildable lot after removing streets and sidewalks. */
  lot: Rect;
}

function buildCells(): Cell[] {
  const cells: Cell[] = [];
  for (let ix = 0; ix < X_EDGES.length - 1; ix++) {
    for (let iz = 0; iz < Z_EDGES.length - 1; iz++) {
      const rect: Rect = { minX: X_EDGES[ix]!, maxX: X_EDGES[ix + 1]!, minZ: Z_EDGES[iz]!, maxZ: Z_EDGES[iz + 1]! };
      const [cx, cz] = rectCenter(rect);
      const sides = {
        west: ix === 0 ? ("edge" as const) : verticalLineKind(rect.minX, cz),
        east: ix === X_EDGES.length - 2 ? ("edge" as const) : verticalLineKind(rect.maxX, cz),
        north: iz === 0 ? ("edge" as const) : horizontalLineKind(rect.minZ, cx),
        south: iz === Z_EDGES.length - 2 ? ("edge" as const) : horizontalLineKind(rect.maxZ, cx),
      };
      const sideInset = (s: LineKind | "edge") => (s === "edge" ? PROMENADE_WIDTH : ROAD_HALF_WIDTH + SIDEWALK_WIDTH);
      const lot = inset(rect, sideInset(sides.west), sideInset(sides.east), sideInset(sides.north), sideInset(sides.south));
      cells.push({ ix, iz, key: `c${ix}_${iz}`, rect, zoneId: zoneAt(cx, cz), sides, lot });
    }
  }
  return cells;
}

function buildStreets(b: LayoutBuilder, cells: Cell[]): void {
  // Street segments along vertical lines.
  for (const x of X_LINES) {
    for (let i = 0; i < Z_EDGES.length - 1; i++) {
      const z0 = Z_EDGES[i]!;
      const z1 = Z_EDGES[i + 1]!;
      const kind = verticalLineKind(x, (z0 + z1) / 2);
      const start = i === 0 ? z0 : z0 + ROAD_HALF_WIDTH;
      const end = i === Z_EDGES.length - 2 ? z1 : z1 - ROAD_HALF_WIDTH;
      b.surface(lineSurface[kind], { minX: x - ROAD_HALF_WIDTH, maxX: x + ROAD_HALF_WIDTH, minZ: start, maxZ: end }, 0.01);
      if (kind === "road") {
        for (let z = start + 3; z < end - 3; z += 6) {
          b.roadMarkings.push({ x, z: z + 1.5, length: 3, width: 0.15, rotation: 0 });
        }
        streetLamps(b, "vertical", x, start, end);
      }
    }
  }
  // Street segments along horizontal lines.
  for (const z of Z_LINES) {
    for (let i = 0; i < X_EDGES.length - 1; i++) {
      const x0 = X_EDGES[i]!;
      const x1 = X_EDGES[i + 1]!;
      const kind = horizontalLineKind(z, (x0 + x1) / 2);
      const start = i === 0 ? x0 : x0 + ROAD_HALF_WIDTH;
      const end = i === X_EDGES.length - 2 ? x1 : x1 - ROAD_HALF_WIDTH;
      b.surface(lineSurface[kind], { minX: start, maxX: end, minZ: z - ROAD_HALF_WIDTH, maxZ: z + ROAD_HALF_WIDTH }, 0.01);
      if (kind === "road") {
        for (let x = start + 3; x < end - 3; x += 6) {
          b.roadMarkings.push({ x: x + 1.5, z, length: 3, width: 0.15, rotation: Math.PI / 2 });
        }
        streetLamps(b, "horizontal", z, start, end);
      }
    }
  }
  // Intersections.
  for (const x of X_LINES) {
    for (const z of Z_LINES) {
      const kinds = [
        verticalLineKind(x, z - 1),
        verticalLineKind(x, z + 1),
        horizontalLineKind(z, x - 1),
        horizontalLineKind(z, x + 1),
      ];
      const kind: LineKind = kinds.includes("road") ? "road" : kinds.includes("pedestrian") ? "pedestrian" : kinds[0]!;
      b.surface(
        lineSurface[kind],
        { minX: x - ROAD_HALF_WIDTH, maxX: x + ROAD_HALF_WIDTH, minZ: z - ROAD_HALF_WIDTH, maxZ: z + ROAD_HALF_WIDTH },
        0.01,
      );
      if (kind === "road") {
        if (verticalLineKind(x, z - 1) === "road") b.crosswalks.push({ x, z: z - ROAD_HALF_WIDTH - 1.6, rotation: 0, width: 10 });
        if (verticalLineKind(x, z + 1) === "road") b.crosswalks.push({ x, z: z + ROAD_HALF_WIDTH + 1.6, rotation: 0, width: 10 });
        if (horizontalLineKind(z, x - 1) === "road") b.crosswalks.push({ x: x - ROAD_HALF_WIDTH - 1.6, z, rotation: Math.PI / 2, width: 10 });
        if (horizontalLineKind(z, x + 1) === "road") b.crosswalks.push({ x: x + ROAD_HALF_WIDTH + 1.6, z, rotation: Math.PI / 2, width: 10 });
      }
    }
  }
  // Sidewalk strips around each cell (or promenade at the map edge).
  for (const c of cells) {
    const r = c.rect;
    const w = c.sides.west === "edge" ? r.minX : r.minX + ROAD_HALF_WIDTH;
    const e = c.sides.east === "edge" ? r.maxX : r.maxX - ROAD_HALF_WIDTH;
    const n = c.sides.north === "edge" ? r.minZ : r.minZ + ROAD_HALF_WIDTH;
    const s = c.sides.south === "edge" ? r.maxZ : r.maxZ - ROAD_HALF_WIDTH;
    const kindFor = (side: LineKind | "edge"): SurfaceKind => {
      if (side === "edge") return c.zoneId === "zone-beach" ? "sand" : "sidewalk";
      return sideSurface[side];
    };
    const l = c.lot;
    b.surface(kindFor(c.sides.north), { minX: w, maxX: e, minZ: n, maxZ: l.minZ }, 0.02);
    b.surface(kindFor(c.sides.south), { minX: w, maxX: e, minZ: l.maxZ, maxZ: s }, 0.02);
    b.surface(kindFor(c.sides.west), { minX: w, maxX: l.minX, minZ: l.minZ, maxZ: l.maxZ }, 0.02);
    b.surface(kindFor(c.sides.east), { minX: l.maxX, maxX: e, minZ: l.minZ, maxZ: l.maxZ }, 0.02);
  }
}

function streetLamps(b: LayoutBuilder, orientation: "vertical" | "horizontal", line: number, start: number, end: number): void {
  const offset = ROAD_HALF_WIDTH + 1.1;
  for (let t = start + 8; t <= end - 8; t += 26) {
    for (const side of [-1, 1]) {
      const along = side < 0 ? t : t + 13;
      if (along > end - 8) continue;
      if (orientation === "vertical") b.prop("lamp", line + side * offset, along, side < 0 ? -Math.PI / 2 : Math.PI / 2);
      else b.prop("lamp", along, line + side * offset, side < 0 ? 0 : Math.PI);
    }
  }
}

const GLASS_COLORS = ["#5d7d96", "#4f6f86", "#6c8aa1", "#3f5d75", "#7d97a8", "#566f7f"];
const OFFICE_COLORS = ["#b8b2a7", "#a9a39a", "#c9c2b5", "#9a958f", "#d1cbc0"];
const BRICK_COLORS = ["#9b5b45", "#8a4f3d", "#a8694f", "#7d4a3a", "#b07a5c"];
const STUCCO_COLORS = ["#e8dcc6", "#e3cfb0", "#d7c4a8", "#efe6d5", "#cfd8d3", "#e6d0c5"];
const SHOP_COLORS = ["#d8c3a5", "#c97b63", "#8fa998", "#e0b973", "#b4a7d6", "#d99a9e", "#9cb4cc"];

const SHOP_NAMES: Record<ZoneId, string[]> = {
  "zone-central": [
    "Café Lumière", "Noodle Bar", "Book Nook", "EntroMart", "Gelato Lab", "Pixel Arcade",
    "Bloom Florist", "Tea House", "Pizza Forno", "Vinyl Records", "Bakery 24", "Sushi Go",
    "Burger Joint", "Juice Club", "Taco Stand", "Gallery 9",
  ],
  "zone-beach": ["Surf Shack", "Ice Cream", "Beach Café", "Fish & Chips", "Sun Shop", "Smoothies", "Boardwalk Bar"],
  "zone-event": ["Grand Hotel", "Ticket Office", "Merch Store", "Stage Door Diner"],
  "zone-business": [],
  "zone-park": [],
  "zone-residential": [],
  "zone-market": [],
  "zone-academy": [],
};

function businessCell(b: LayoutBuilder, c: Cell): void {
  const rng = b.rng;
  const lot = c.lot;
  b.surface("concrete", lot, 0.03);
  const cols = 2;
  const rows = 2;
  const gap = 6;
  const pw = (lot.maxX - lot.minX - gap) / cols;
  const pd = (lot.maxZ - lot.minZ - gap) / rows;
  const plazaIndex = Math.floor(rng() * 4);
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const px = lot.minX + i * (pw + gap);
      const pz = lot.minZ + j * (pd + gap);
      const parcel: Rect = { minX: px, maxX: px + pw, minZ: pz, maxZ: pz + pd };
      const [cx, cz] = rectCenter(parcel);
      if (i * rows + j === plazaIndex) {
        // Small pocket plaza with trees and benches.
        b.prop("tree", round(cx - 8), round(cz - 8), 0, 1.1);
        b.prop("tree", round(cx + 8), round(cz + 8), 0, 1.1);
        b.prop("tree", round(cx + 8), round(cz - 8), 0, 1.0);
        b.prop("bench", round(cx - 5), round(cz + 6), Math.PI / 2);
        b.prop("bench", round(cx + 5), round(cz - 6), -Math.PI / 2);
        b.prop("planter", round(cx), round(cz), 0);
        continue;
      }
      const setbackX = range(rng, 2, 5);
      const setbackZ = range(rng, 2, 5);
      const width = round(pw - setbackX * 2);
      const depth = round(pd - setbackZ * 2);
      const glass = rng() < 0.6;
      const height = round(glass ? range(rng, 55, 118) : range(rng, 28, 62));
      b.building({
        x: round(cx),
        z: round(cz),
        width,
        depth,
        height,
        rotation: 0,
        facade: glass ? "glass" : "office",
        color: glass ? pick(rng, GLASS_COLORS) : pick(rng, OFFICE_COLORS),
        roof: "flat",
        setback: height > 70 && rng() < 0.7 ? { height: round(height * range(rng, 0.65, 0.8)), inset: 3 } : undefined,
      });
    }
  }
}

/** The big central plaza square around the fountain. */
const CENTRAL_PLAZA: Rect = { minX: -46, maxX: 46, minZ: -126, maxZ: -34 };
const FOUNTAIN = { x: 0, z: -80 };

function centralCell(b: LayoutBuilder, c: Cell): void {
  const rng = b.rng;
  const lot = c.lot;
  b.surface("plaza", lot, 0.03);
  const names = SHOP_NAMES["zone-central"];
  const depth = 14;
  // Which outer edges face away from the plaza center?
  const outerZ = c.rect.minZ < -80 ? "north" : "south";
  const outerX = c.rect.minX < 0 ? "west" : "east";
  // Row of shops along the outer horizontal edge.
  const rowZ = outerZ === "north" ? lot.minZ + depth / 2 : lot.maxZ - depth / 2;
  const rotZ = outerZ === "north" ? Math.PI : 0; // front faces the plaza
  let x = lot.minX + (outerX === "west" ? depth : 0);
  const xEnd = lot.maxX - (outerX === "east" ? depth : 0);
  while (x < xEnd - 8) {
    const w = Math.min(round(range(rng, 11, 16)), xEnd - x);
    b.building({
      x: round(x + w / 2),
      z: round(rowZ),
      width: w - 0.4,
      depth,
      height: round(range(rng, 8, 19)),
      rotation: rotZ,
      facade: "shop",
      color: pick(rng, SHOP_COLORS),
      roof: "flat",
      sign: names[(b.buildings.length * 7) % names.length],
    });
    x += w;
  }
  // Column of shops along the outer vertical edge.
  const colX = outerX === "west" ? lot.minX + depth / 2 : lot.maxX - depth / 2;
  const rotX = outerX === "west" ? -Math.PI / 2 : Math.PI / 2;
  let z = lot.minZ;
  const zEnd = lot.maxZ;
  while (z < zEnd - 8) {
    const w = Math.min(round(range(rng, 11, 16)), zEnd - z);
    b.building({
      x: round(colX),
      z: round(z + w / 2),
      width: w - 0.4,
      depth,
      height: round(range(rng, 9, 22)),
      rotation: rotX,
      facade: "shop",
      color: pick(rng, SHOP_COLORS),
      roof: "flat",
      sign: names[(b.buildings.length * 5) % names.length],
    });
    z += w;
  }
  // Street trees and benches in the open area between shops and the plaza square.
  const open: Rect = {
    minX: outerX === "west" ? lot.minX + depth + 3 : lot.minX + 2,
    maxX: outerX === "east" ? lot.maxX - depth - 3 : lot.maxX - 2,
    minZ: outerZ === "north" ? lot.minZ + depth + 3 : lot.minZ + 2,
    maxZ: outerZ === "south" ? lot.maxZ - depth - 3 : lot.maxZ - 2,
  };
  b.scatter("planter", open, 3, [CENTRAL_PLAZA], 10);
  b.scatter("tree", open, 5, [CENTRAL_PLAZA], 8);
}

function centralPlaza(b: LayoutBuilder): void {
  b.surface("plaza", CENTRAL_PLAZA, 0.04);
  // Fountain (interactive: can be toggled on and off) - basin and center column.
  b.cylinder(FOUNTAIN.x, 0.35, FOUNTAIN.z, 6.5, 0.35);
  b.cylinder(FOUNTAIN.x, 1.75, FOUNTAIN.z, 1.0, 1.75);
  b.interactive({ id: "fountain:central", kind: "fountain", x: FOUNTAIN.x, y: 0.7, z: FOUNTAIN.z, rotation: 0, radius: 9, label: "Fountain" });
  // Ring of benches facing the fountain.
  const benches = 12;
  for (let i = 0; i < benches; i++) {
    const a = (i / benches) * Math.PI * 2 + Math.PI / benches;
    const r = 12.5;
    b.prop("bench", round(FOUNTAIN.x + Math.sin(a) * r), round(FOUNTAIN.z + Math.cos(a) * r), round(a));
  }
  // Trees in planters at the plaza corners and lamps around.
  for (const [dx, dz] of [[-34, -34], [34, -34], [-34, 34], [34, 34], [-34, 0], [34, 0], [0, -34], [0, 34]] as const) {
    if (dx === 0 || dz === 0) {
      b.prop("lamp", FOUNTAIN.x + dx * 0.62, FOUNTAIN.z + dz * 0.62, 0);
      continue;
    }
    b.prop("tree", FOUNTAIN.x + dx, FOUNTAIN.z + dz, 0, 1.3);
    b.prop("flowerbed", FOUNTAIN.x + dx * 0.7, FOUNTAIN.z + dz * 0.7, 0, 1);
  }
  b.interactive({ id: "board:central", kind: "board", x: 22, y: 0, z: -62, rotation: round(Math.PI * 1.25), radius: 3.5, label: "Plaza notice board" });
  b.box(22, 1.1, -62, 1.3, 1.1, 0.25, round(Math.PI * 1.25));
  b.interactive({ id: "kiosk:central", kind: "kiosk", x: -22, y: 0, z: -62, rotation: round(Math.PI * 0.75), radius: 3, label: "City transit kiosk" });
  b.box(-22, 1.1, -62, 0.6, 1.1, 0.6, round(Math.PI * 0.75));
  b.venues.push({ id: "venue:plaza", name: "Central Plaza fountain", zoneId: "zone-central", x: 0, y: 0, z: -66 });
}

const AMPHI = { x: 206, z: -126 };

function eventCell(b: LayoutBuilder, c: Cell): void {
  const rng = b.rng;
  const lot = c.lot;
  const [cx, cz] = rectCenter(lot);
  if (c.ix === 5 && c.iz === 0) {
    // Open-air amphitheater: stage, screen, seating rows and light towers.
    b.surface("concrete", lot, 0.03);
    const stage = { x: AMPHI.x, z: lot.minZ + 12, w: 26, d: 11, h: 1.2 };
    b.box(stage.x, stage.h / 2, stage.z, stage.w / 2, stage.h / 2, stage.d / 2, 0, "col-stage");
    // Steps up to the stage on both sides (autostep handles 0.4 m rises).
    for (const side of [-1, 1]) {
      for (let s = 0; s < 3; s++) {
        const h = 0.4 * (s + 1);
        b.box(stage.x + side * (stage.w / 2 + 2.2 - s * 0.8), h / 2, stage.z + 3, 0.4, h / 2, 1.5, 0);
      }
    }
    b.box(stage.x, 7.5, lot.minZ + 4.6, 12, 6, 0.4, 0, "col-screen");
    b.interactive({ id: "screen:amphitheater", kind: "screen", x: stage.x, y: 7.5, z: lot.minZ + 5.2, rotation: 0, radius: 60, label: "Event screen" });
    for (let row = 0; row < 6; row++) {
      const z = stage.z + 16 + row * 4;
      const perRow = 5 + Math.floor(row / 2);
      for (let k = 0; k < perRow; k++) {
        const x = stage.x + (k - (perRow - 1) / 2) * 5.2;
        b.prop("bench", round(x), round(z), 0);
      }
    }
    b.prop("lightTower", stage.x - 22, stage.z + 2, 0);
    b.prop("lightTower", stage.x + 22, stage.z + 2, 0);
    b.venues.push({ id: "venue:amphitheater", name: "Amphitheater stage", zoneId: "zone-event", x: stage.x, y: stage.h, z: stage.z });
    b.scatter("tree", { minX: lot.minX + 2, maxX: lot.minX + 10, minZ: lot.minZ + 2, maxZ: lot.maxZ - 2 }, 4, [], 7);
    b.scatter("tree", { minX: lot.maxX - 10, maxX: lot.maxX - 2, minZ: lot.minZ + 2, maxZ: lot.maxZ - 2 }, 4, [], 7);
    return;
  }
  if (c.ix === 4 && c.iz === 0) {
    // Convention hall.
    b.surface("plaza", lot, 0.03);
    b.building({ x: round(cx), z: round(cz - 6), width: 52, depth: 40, height: 17, rotation: Math.PI, facade: "hall", color: "#c7ccd1", roof: "flat", sign: "EVENT CENTER" });
    b.interactive({ id: "board:events", kind: "board", x: round(cx - 8), y: 0, z: round(lot.maxZ - 8), rotation: 0, radius: 3.5, label: "Events board" });
    b.box(round(cx - 8), 1.1, round(lot.maxZ - 8), 1.3, 1.1, 0.25, 0);
    b.interactive({ id: "kiosk:event", kind: "kiosk", x: round(cx + 8), y: 0, z: round(lot.maxZ - 8), rotation: 0, radius: 3, label: "City transit kiosk" });
    b.box(round(cx + 8), 1.1, round(lot.maxZ - 8), 0.6, 1.1, 0.6, 0);
    b.prop("tree", round(lot.minX + 4), round(lot.maxZ - 4), 0, 1.2);
    b.prop("tree", round(lot.maxX - 4), round(lot.maxZ - 4), 0, 1.2);
    return;
  }
  // Event plaza with hotels, food trucks and seating.
  b.surface("plaza", lot, 0.03);
  const names = SHOP_NAMES["zone-event"];
  const hotelW = 22;
  b.building({
    x: round(c.ix === 4 ? lot.minX + hotelW / 2 : lot.maxX - hotelW / 2),
    z: round(cz),
    width: lot.maxZ - lot.minZ - 8,
    depth: hotelW,
    height: round(range(rng, 24, 40)),
    rotation: c.ix === 4 ? -Math.PI / 2 : Math.PI / 2,
    facade: c.ix === 4 ? "stucco" : "office",
    color: c.ix === 4 ? pick(rng, STUCCO_COLORS) : pick(rng, OFFICE_COLORS),
    roof: "flat",
    sign: names[c.ix === 4 ? 0 : 1],
  });
  const openMinX = c.ix === 4 ? lot.minX + hotelW + 4 : lot.minX + 4;
  const openMaxX = c.ix === 4 ? lot.maxX - 4 : lot.maxX - hotelW - 4;
  for (let i = 0; i < 3; i++) {
    b.prop("foodTruck", round(openMinX + 8 + i * 12), round(lot.minZ + 6), 0, 1, 0, pick(rng, SHOP_COLORS));
  }
  for (let i = 0; i < 4; i++) {
    b.prop("picnic", round(openMinX + 6 + i * 9), round(cz + 4), 0);
  }
  b.scatter("tree", { minX: openMinX, maxX: openMaxX, minZ: cz + 12, maxZ: lot.maxZ - 3 }, 5, [], 7);
  if (c.ix === 5) {
    b.prop("bench", round(openMinX + 6), round(cz - 6), Math.PI);
    b.prop("bench", round(openMinX + 14), round(cz - 6), Math.PI);
  }
}

const POND = { x: 42, z: 124, rx: 15, rz: 11 };

function parkCell(b: LayoutBuilder, c: Cell): void {
  const lot = c.lot;
  b.surface("grass", lot, 0.03);
  const avoid: Rect[] = [];
  if (c.ix === 3 && c.iz === 3) {
    // Pond with an invisible rim so players cannot walk on water.
    b.water.push({ id: "pond", kind: "pond", x: POND.x, z: POND.z, width: POND.rx * 2, depth: POND.rz * 2 });
    const segments = 20;
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const x0 = POND.x + Math.cos(a0) * POND.rx;
      const z0 = POND.z + Math.sin(a0) * POND.rz;
      const x1 = POND.x + Math.cos(a1) * POND.rx;
      const z1 = POND.z + Math.sin(a1) * POND.rz;
      const len = Math.hypot(x1 - x0, z1 - z0);
      const yaw = Math.atan2(-(z1 - z0), x1 - x0);
      b.box(round((x0 + x1) / 2), 1.2, round((z0 + z1) / 2), round(len / 2 + 0.2), 1.2, 0.25, round(yaw));
    }
    avoid.push({ minX: POND.x - POND.rx - 3, maxX: POND.x + POND.rx + 3, minZ: POND.z - POND.rz - 3, maxZ: POND.z + POND.rz + 3 });
    b.prop("bench", POND.x - POND.rx - 4, POND.z, -Math.PI / 2);
    b.prop("bench", POND.x, POND.z - POND.rz - 4, 0);
  }
  if (c.ix === 2 && c.iz === 2) {
    // Bandstand / gazebo seating area: a ring of benches around a statue.
    const gx = (lot.minX + lot.maxX) / 2;
    const gz = (lot.minZ + lot.maxZ) / 2;
    b.prop("statue", round(gx), round(gz), 0, 1);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.prop("bench", round(gx + Math.sin(a) * 7), round(gz + Math.cos(a) * 7), round(a));
    }
    avoid.push({ minX: gx - 10, maxX: gx + 10, minZ: gz - 10, maxZ: gz + 10 });
    b.venues.push({ id: "venue:park", name: "Park bandstand", zoneId: "zone-park", x: round(gx), y: 0, z: round(gz + 9) });
  }
  if (c.ix === 2 && c.iz === 3) {
    for (let i = 0; i < 4; i++) b.prop("picnic", round(lot.minX + 12 + i * 10), round(lot.minZ + 14), 0);
    avoid.push({ minX: lot.minX + 6, maxX: lot.minX + 50, minZ: lot.minZ + 10, maxZ: lot.minZ + 18 });
  }
  if (c.ix === 3 && c.iz === 2) {
    b.interactive({ id: "board:park", kind: "board", x: round(lot.minX + 6), y: 0, z: round(lot.minZ + 6), rotation: round(Math.PI * 1.75), radius: 3.5, label: "Park notice board" });
    b.box(round(lot.minX + 6), 1.1, round(lot.minZ + 6), 1.3, 1.1, 0.25, round(Math.PI * 1.75));
    b.interactive({ id: "kiosk:park", kind: "kiosk", x: round(lot.minX + 12), y: 0, z: round(lot.minZ + 4), rotation: Math.PI, radius: 3, label: "City transit kiosk" });
    b.box(round(lot.minX + 12), 1.1, round(lot.minZ + 4), 0.6, 1.1, 0.6, Math.PI);
    avoid.push({ minX: lot.minX, maxX: lot.minX + 16, minZ: lot.minZ, maxZ: lot.minZ + 10 });
  }
  // Benches along the paths.
  const [cx, cz] = rectCenter(lot);
  b.prop("bench", round(c.ix === 2 ? lot.maxX - 1.2 : lot.minX + 1.2), round(cz - 10), c.ix === 2 ? Math.PI / 2 : -Math.PI / 2);
  b.prop("bench", round(cx + 10), round(c.iz === 2 ? lot.maxZ - 1.2 : lot.minZ + 1.2), c.iz === 2 ? Math.PI : 0);
  b.scatter("tree", inset(lot, 3, 3, 3, 3), 26, avoid, 7, [0.9, 1.5]);
  b.scatter("bush", inset(lot, 2, 2, 2, 2), 14, avoid, 5, [0.8, 1.3]);
}

function residentialCell(b: LayoutBuilder, c: Cell): void {
  const rng = b.rng;
  const lot = c.lot;
  b.surface("grass", lot, 0.03);
  if (c.ix === 1) {
    // Property plots: two rows of three, fronts facing the streets to the north and south.
    const plotW = 20;
    const plotD = 30;
    const gapX = (lot.maxX - lot.minX - plotW * 3) / 2;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        const minX = lot.minX + col * (plotW + gapX);
        const minZ = row === 0 ? lot.minZ : lot.maxZ - plotD;
        const bounds: Rect = { minX, maxX: minX + plotW, minZ, maxZ: minZ + plotD };
        const [px, pz] = rectCenter(bounds);
        const rotation = row === 0 ? 0 : Math.PI;
        const number = b.plots.length + 1;
        const plot: Plot = {
          id: `plot-${number}`,
          zoneId: "zone-residential",
          chunk: chunkKeyAt(px, pz),
          number,
          x: round(px),
          z: round(pz),
          rotation,
          width: plotW,
          depth: plotD,
          bounds,
          house: { width: 11, depth: 9, centerZ: -3.5, wallHeight: 3.4, doorWidth: 2 },
        };
        b.plots.push(plot);
        houseShell(b, plot);
        const [sx, sz] = rotY(-plotW / 2 + 2, -plotD / 2 + 1.5, rotation);
        b.interactive({ id: `plotSign:${plot.id}`, kind: "plotSign", x: round(px + sx), y: 0, z: round(pz + sz), rotation, radius: 4, label: `Lot ${number}`, ref: plot.id });
        const [tx, tz] = rotY(plotW / 2 - 2.5, plotD / 2 - 3, rotation);
        b.prop("tree", round(px + tx), round(pz + tz), 0, 1.1);
      }
    }
    if (c.iz === 2) {
      b.interactive({ id: "board:residential", kind: "board", x: round(lot.minX + 30), y: 0, z: round((lot.minZ + lot.maxZ) / 2), rotation: 0, radius: 3.5, label: "Neighborhood board" });
      b.box(round(lot.minX + 30), 1.1, round((lot.minZ + lot.maxZ) / 2), 1.3, 1.1, 0.25, 0);
      b.interactive({ id: "kiosk:residential", kind: "kiosk", x: round(lot.minX + 36), y: 0, z: round((lot.minZ + lot.maxZ) / 2), rotation: 0, radius: 3, label: "City transit kiosk" });
      b.box(round(lot.minX + 36), 1.1, round((lot.minZ + lot.maxZ) / 2), 0.6, 1.1, 0.6, 0);
    }
    return;
  }
  // Apartment blocks with gardens.
  const count = 2;
  const w = (lot.maxX - lot.minX - 10) / count;
  for (let i = 0; i < count; i++) {
    const x = lot.minX + 5 + w * i + w / 2;
    const brick = rng() < 0.55;
    b.building({
      x: round(x),
      z: round(lot.minZ + 14),
      width: round(w - 6),
      depth: 18,
      height: round(range(rng, 16, 30)),
      rotation: 0,
      facade: brick ? "brick" : "stucco",
      color: brick ? pick(rng, BRICK_COLORS) : pick(rng, STUCCO_COLORS),
      roof: "flat",
    });
  }
  const garden: Rect = { minX: lot.minX + 3, maxX: lot.maxX - 3, minZ: lot.minZ + 28, maxZ: lot.maxZ - 3 };
  b.scatter("tree", garden, 9, [], 7);
  b.prop("bench", round(garden.minX + 12), round(garden.minZ + 10), 0);
  b.prop("bench", round(garden.maxX - 12), round(garden.minZ + 10), 0);
  b.prop("picnic", round((garden.minX + garden.maxX) / 2), round(garden.maxZ - 8), 0);
}

function houseShell(b: LayoutBuilder, plot: Plot): void {
  const { width, depth, centerZ, wallHeight, doorWidth } = plot.house;
  const t = 0.2;
  const hy = wallHeight / 2;
  const walls: [number, number, number, number][] = [
    // [localX, localZ, halfX, halfZ]
    [0, centerZ + depth / 2, width / 2, t / 2], // back
    [-width / 2, centerZ, t / 2, depth / 2], // left
    [width / 2, centerZ, t / 2, depth / 2], // right
  ];
  const sideLen = (width - doorWidth) / 2;
  walls.push([-(doorWidth / 2 + sideLen / 2), centerZ - depth / 2, sideLen / 2, t / 2]);
  walls.push([doorWidth / 2 + sideLen / 2, centerZ - depth / 2, sideLen / 2, t / 2]);
  for (const [lx, lz, hx, hz] of walls) {
    const [dx, dz] = rotY(lx, lz, plot.rotation);
    b.box(round(plot.x + dx), hy, round(plot.z + dz), hx, hy, hz, plot.rotation);
  }
}

function beachCell(b: LayoutBuilder, c: Cell): void {
  const rng = b.rng;
  const lot = c.lot;
  if (c.ix === 4) {
    // Boardwalk shops.
    b.surface("concrete", lot, 0.03);
    const names = SHOP_NAMES["zone-beach"];
    let z = lot.minZ + 2;
    let n = c.iz === 2 ? 0 : 3;
    while (z < lot.maxZ - 14) {
      const w = round(range(rng, 12, 16));
      b.building({
        x: round(lot.minX + 8),
        z: round(z + w / 2),
        width: w - 0.6,
        depth: 14,
        height: round(range(rng, 6, 10)),
        rotation: -Math.PI / 2,
        facade: "shop",
        color: pick(rng, SHOP_COLORS),
        roof: "flat",
        sign: names[n++ % names.length],
      });
      z += w + 2;
    }
    for (let i = 0; i < 4; i++) {
      b.prop("umbrella", round(lot.minX + 24), round(lot.minZ + 10 + i * 14), 0, 1, 0, pick(rng, ["#e85d4a", "#f2b134", "#3c8dbc", "#2fa37a"]));
      b.prop("picnic", round(lot.minX + 24), round(lot.minZ + 10 + i * 14), 0);
    }
    b.scatter("palm", { minX: lot.minX + 30, maxX: lot.maxX - 2, minZ: lot.minZ + 2, maxZ: lot.maxZ - 2 }, 8, [], 8);
    if (c.iz === 2) {
      b.interactive({ id: "board:beach", kind: "board", x: round(lot.maxX - 6), y: 0, z: round(lot.minZ + 6), rotation: Math.PI / 2, radius: 3.5, label: "Beach notice board" });
      b.box(round(lot.maxX - 6), 1.1, round(lot.minZ + 6), 1.3, 1.1, 0.25, Math.PI / 2);
      b.interactive({ id: "kiosk:beach", kind: "kiosk", x: round(lot.maxX - 6), y: 0, z: round(lot.minZ + 14), rotation: Math.PI / 2, radius: 3, label: "City transit kiosk" });
      b.box(round(lot.maxX - 6), 1.1, round(lot.minZ + 14), 0.6, 1.1, 0.6, Math.PI / 2);
    }
    return;
  }
  // Sand beach down to the waterline.
  b.surface("sand", { minX: lot.minX - 4, maxX: SHORELINE_X - 3, minZ: c.rect.minZ + (c.iz === 2 ? ROAD_HALF_WIDTH : 0), maxZ: c.rect.maxZ }, 0.03);
  b.surface("wetsand", { minX: SHORELINE_X - 3, maxX: MAP_BOUNDS.maxX, minZ: c.rect.minZ + (c.iz === 2 ? ROAD_HALF_WIDTH : 0), maxZ: c.rect.maxZ }, 0.03);
  for (let i = 0; i < 5; i++) {
    const z = lot.minZ + 8 + i * 14;
    const x = SHORELINE_X - 22 + (i % 2) * 5;
    b.prop("umbrella", round(x), round(z), 0, 1, 0, pick(rng, ["#e85d4a", "#f2b134", "#3c8dbc", "#2fa37a", "#f4f1de"]));
    b.prop("lounger", round(x - 1.6), round(z + 1.6), Math.PI / 2);
    b.prop("lounger", round(x + 1.6), round(z + 1.6), Math.PI / 2);
  }
  if (c.iz === 2) {
    b.prop("lifeguard", SHORELINE_X - 10, 40, -Math.PI / 2);
    b.prop("volleyNet", 190, 30, 0);
    b.venues.push({ id: "venue:beach", name: "Beach stage", zoneId: "zone-beach", x: 196, y: 0, z: 56 });
  } else {
    b.prop("volleyNet", 190, 130, 0);
  }
  b.scatter("palm", { minX: lot.minX, maxX: lot.minX + 16, minZ: lot.minZ + 2, maxZ: lot.maxZ - 2 }, 6, [], 8);
}

function boundaries(b: LayoutBuilder): void {
  const H = 3;
  const { minX, maxX, minZ, maxZ } = MAP_BOUNDS;
  // West, north and south seawalls (players cannot leave the island).
  b.wall("west", minX - 1, minX, minZ - 1, maxZ + 1, H);
  b.wall("north", minX - 1, maxX + 1, minZ - 1, minZ, H);
  b.wall("south", minX - 1, maxX + 1, maxZ, maxZ + 1, H);
  // East: seawall next to the event zone, and the shoreline in the beach zone.
  b.wall("east", maxX, maxX + 1, minZ - 1, 1, H);
  b.wall("shore", SHORELINE_X, SHORELINE_X + 1, -1, maxZ + 1, H);
  b.wall("shore-corner", SHORELINE_X, maxX + 1, 0, 1, H);
  b.water.push({ id: "sea", kind: "sea", x: 0, z: 0, width: 2400, depth: 2400 });
}

function buildZones(): ZoneLayout[] {
  const spawn = (x: number, z: number, rotation: number) => ({ x, y: 0, z, rotation });
  return [
    { id: "zone-central", name: ZONES["zone-central"].name, bounds: ZONE_BOUNDS["zone-central"], spawn: spawn(7, -52, 0), ambience: "plaza" },
    { id: "zone-business", name: ZONES["zone-business"].name, bounds: ZONE_BOUNDS["zone-business"], spawn: spawn(-160, -40, 0), ambience: "urban" },
    { id: "zone-residential", name: ZONES["zone-residential"].name, bounds: ZONE_BOUNDS["zone-residential"], spawn: spawn(-112, 40, Math.PI / 2), ambience: "residential" },
    { id: "zone-park", name: ZONES["zone-park"].name, bounds: ZONE_BOUNDS["zone-park"], spawn: spawn(-60, 16, Math.PI), ambience: "nature" },
    { id: "zone-beach", name: ZONES["zone-beach"].name, bounds: ZONE_BOUNDS["zone-beach"], spawn: spawn(152, 20, -Math.PI / 2), ambience: "beach" },
    { id: "zone-event", name: ZONES["zone-event"].name, bounds: ZONE_BOUNDS["zone-event"], spawn: spawn(120, -40, 0), ambience: "event" },
    // At the street gate, looking across the boulevard into Code Corner.
    { id: "zone-market", name: ZONES["zone-market"].name, bounds: ZONE_BOUNDS["zone-market"], spawn: spawn(-272, -80, Math.PI / 2), ambience: "urban" },
    // On the campus walkway, facing the Puzzle Lab.
    { id: "zone-academy", name: ZONES["zone-academy"].name, bounds: ZONE_BOUNDS["zone-academy"], spawn: spawn(-268, 80, Math.PI / 2), ambience: "plaza" },
  ];
}

export function generateCityLayout(seed = CITY_SEED): CityLayout {
  const rng = createRng(seed);
  const b = new LayoutBuilder(rng);
  const cells = buildCells();
  buildStreets(b, cells);
  for (const cell of cells) {
    switch (cell.zoneId) {
      case "zone-business":
        businessCell(b, cell);
        break;
      case "zone-central":
        centralCell(b, cell);
        break;
      case "zone-event":
        eventCell(b, cell);
        break;
      case "zone-park":
        parkCell(b, cell);
        break;
      case "zone-residential":
        residentialCell(b, cell);
        break;
      case "zone-beach":
        beachCell(b, cell);
        break;
    }
  }
  centralPlaza(b);
  // Generated last, with its own random stream, so the original districts are unaffected.
  const shops = agentStreet(new LayoutBuilderView(b, createRng(seed ^ 0x5eed_a1)));
  const academy = academyCampus(new LayoutBuilderView(b, createRng(seed ^ 0xac_ade)));
  boundaries(b);
  // Business district kiosk and board near the spawn point.
  b.interactive({ id: "kiosk:business", kind: "kiosk", x: -166, y: 0, z: -46, rotation: 0, radius: 3, label: "City transit kiosk" });
  b.box(-166, 1.1, -46, 0.6, 1.1, 0.6, 0);

  const chunks: Chunk[] = cells.map((c) => ({ key: c.key, rect: c.rect, zoneId: c.zoneId }));
  for (let i = 0; i < ANNEX_CHUNK_ROWS; i++) {
    const rect: Rect = { ...MARKET_ANNEX, minZ: Z_EDGES[i]!, maxZ: Math.min(Z_EDGES[i + 1]!, MARKET_ANNEX.maxZ) };
    chunks.push({ key: `a0_${i}`, rect, zoneId: "zone-market" });
  }
  for (let i = 0; i < ANNEX_CHUNK_ROWS; i++) {
    const z0 = Z_EDGES[i + ANNEX_CHUNK_ROWS]!;
    const rect: Rect = { ...ACADEMY_ANNEX, minZ: Math.max(z0, ACADEMY_ANNEX.minZ), maxZ: Math.min(Z_EDGES[i + ANNEX_CHUNK_ROWS + 1]!, ACADEMY_ANNEX.maxZ) };
    chunks.push({ key: `a1_${i}`, rect, zoneId: "zone-academy" });
  }
  return {
    version: LAYOUT_VERSION,
    bounds: MAP_BOUNDS,
    zones: buildZones(),
    chunks,
    surfaces: b.surfaces,
    roadMarkings: b.roadMarkings,
    crosswalks: b.crosswalks,
    buildings: b.buildings,
    props: b.props,
    interactives: b.interactives,
    plots: b.plots,
    venues: b.venues,
    shops,
    academy,
    water: b.water,
    colliders: b.colliders,
  };
}

// -------------------------------------------------------------------------------------------------
// AI Agent Street (zone-market)
// -------------------------------------------------------------------------------------------------

/** Shares the builder's output lists but draws randomness from a separate stream. */
class LayoutBuilderView {
  constructor(
    readonly b: LayoutBuilder,
    readonly rng: () => number,
  ) {}
}

/** Center line of the pedestrian boulevard that runs north-south through the annex. */
export const AGENT_STREET_X = -290;
const BOULEVARD_HALF_WIDTH = 7;
/** The arch over the connector from the Business District road at z = -80. */
export const AGENT_STREET_GATE = { x: -254, z: -80, width: 13, label: "AI AGENT STREET" } as const;

/**
 * The shops of AI Agent Street, one per AI agent (slugs match `market_shops.slug`). Only open shops
 * have an interior and a shopkeeper; the rest are storefronts that open in later milestones.
 */
const AGENT_SHOPS: { slug: string; name: string; open: boolean; side: "west" | "east"; z: number; color: string }[] = [
  { slug: "code-corner", name: "Code Corner", open: true, side: "west", z: -80, color: "#5b7fa6" },
  { slug: "book-cafe", name: "Book Café", open: false, side: "west", z: -128, color: "#c9a27e" },
  { slug: "language-school", name: "Language School", open: false, side: "west", z: -32, color: "#9cb4cc" },
  { slug: "design-studio", name: "Design Studio", open: false, side: "east", z: -140, color: "#d99a9e" },
  { slug: "career-office", name: "Career Office", open: false, side: "east", z: -112, color: "#b8b2a7" },
  { slug: "travel-agency", name: "Travel Agency", open: false, side: "east", z: -48, color: "#8fa998" },
  { slug: "wellness-corner", name: "Wellness Corner", open: false, side: "east", z: -20, color: "#e0b973" },
];

/** Interior dimensions of an open shop (local space: front at -depth/2, counter across the room). */
export const OPEN_SHOP = {
  width: 16,
  depth: 14,
  height: 5,
  wall: 0.3,
  /** Local z of the counter's center line, and its half thickness and height. */
  counterZ: 2.2,
  counterHalfDepth: 0.45,
  counterHeight: 1.05,
  keeperZ: 3.7,
  triggerZ: -1.6,
  triggerRadius: 4.6,
} as const;

function agentStreet(view: LayoutBuilderView): MarketShop[] {
  const { b, rng } = view;
  const a = MARKET_ANNEX;
  const bx0 = AGENT_STREET_X - BOULEVARD_HALF_WIDTH;
  const bx1 = AGENT_STREET_X + BOULEVARD_HALF_WIDTH;
  const gate = AGENT_STREET_GATE;
  b.surface("sidewalk", a, 0.02);
  b.surface("plaza", { minX: bx0, maxX: bx1, minZ: a.minZ + PROMENADE_WIDTH, maxZ: a.maxZ - PROMENADE_WIDTH }, 0.03);
  b.surface("plaza", { minX: bx1, maxX: a.maxX, minZ: gate.z - gate.width / 2, maxZ: gate.z + gate.width / 2 }, 0.03);

  // Gate pillars (the arch itself is drawn by the client).
  for (const side of [-1, 1]) b.cylinder(gate.x, 2.5, gate.z + side * (gate.width / 2 + 0.5), 0.55, 2.5);

  const shops: MarketShop[] = [];
  for (const def of AGENT_SHOPS) {
    // West-side fronts face +x (yaw -PI/2), east-side fronts face -x (yaw PI/2).
    const rotation = def.side === "west" ? -Math.PI / 2 : Math.PI / 2;
    const depth = def.open ? OPEN_SHOP.depth : 12;
    const width = def.open ? OPEN_SHOP.width : 16;
    const frontX = def.side === "west" ? bx0 - 2 : bx1 + 2;
    const x = round(def.side === "west" ? frontX - depth / 2 : frontX + depth / 2);
    const z = def.z;
    const height = def.open ? OPEN_SHOP.height : round(range(rng, 7, 10));
    const local = (lx: number, lz: number) => {
      const [dx, dz] = rotY(lx, lz, rotation);
      return { x: round(x + dx), z: round(z + dz) };
    };
    const keeper = { ...local(0, OPEN_SHOP.keeperZ), rotation: round(rotation) };
    const trigger = { ...local(0, OPEN_SHOP.triggerZ), radius: OPEN_SHOP.triggerRadius };
    shops.push({
      slug: def.slug,
      name: def.name,
      zoneId: zoneAt(x, z),
      chunk: chunkKeyAt(x, z),
      x,
      z,
      rotation: round(rotation),
      width,
      depth,
      height,
      color: def.color,
      open: def.open,
      keeper,
      trigger,
    });
    if (!def.open) {
      b.building({ x, z, width, depth, height, rotation, facade: "shop", color: def.color, roof: "flat", sign: def.name });
      continue;
    }
    // Open shop: back wall, side walls and the counter collide; the front is open.
    const S = OPEN_SHOP;
    const wallBox = (lx: number, lz: number, hx: number, hz: number, hy: number) => {
      const c = local(lx, lz);
      // Rotation is a multiple of PI/2, so the box stays axis-aligned with swapped extents.
      b.box(c.x, hy, c.z, hz, hy, hx);
    };
    wallBox(0, S.depth / 2 - S.wall / 2, S.width / 2, S.wall / 2, S.height / 2);
    for (const side of [-1, 1]) wallBox(side * (S.width / 2 - S.wall / 2), 0, S.wall / 2, S.depth / 2, S.height / 2);
    wallBox(0, S.counterZ, S.width / 2, S.counterHalfDepth, S.counterHeight / 2);
    b.interactive({
      id: `shop:${def.slug}`,
      kind: "shopkeeper",
      x: trigger.x,
      y: 0,
      z: trigger.z,
      rotation: round(rotation),
      radius: S.triggerRadius,
      label: def.name,
      ref: def.slug,
    });
  }

  // Street furniture along the boulevard edges, skipping the stretches in front of shop doors.
  const fronts = shops.map((s) => ({ minZ: s.z - s.width / 2 - 1, maxZ: s.z + s.width / 2 + 1 }));
  const gateGap = { minZ: gate.z - gate.width / 2 - 1, maxZ: gate.z + gate.width / 2 + 1 };
  const clear = (z: number, sideFronts: typeof fronts) => !sideFronts.some((f) => z > f.minZ && z < f.maxZ);
  const westFronts = fronts.filter((_, i) => AGENT_SHOPS[i]!.side === "west");
  const eastFronts = [...fronts.filter((_, i) => AGENT_SHOPS[i]!.side === "east"), gateGap];
  for (let z = a.minZ + 12; z <= a.maxZ - 10; z += 14) {
    if (clear(z, westFronts)) b.prop("lamp", bx0 + 0.8, z, -Math.PI / 2);
    if (clear(z + 7, eastFronts)) b.prop("lamp", bx1 - 0.8, z + 7, Math.PI / 2);
  }
  for (const z of [-152, -96, -64, -8]) {
    b.prop("planter", AGENT_STREET_X, z, 0);
    b.prop("tree", AGENT_STREET_X, z, 0, 0.9);
  }
  for (const z of [-104, -56]) b.prop("bench", AGENT_STREET_X, z, Math.PI / 2);
  // A small garden between the east shops and the Business District.
  const garden: Rect = { minX: bx1 + 16, maxX: a.maxX - 3, minZ: a.minZ + 6, maxZ: a.maxZ - 6 };
  b.scatterWith(rng, "tree", garden, 10, [{ minX: garden.minX - 2, maxX: a.maxX, minZ: gate.z - 16, maxZ: gate.z + 16 }], 9);

  // Transit kiosk and notice board by the gate.
  b.interactive({ id: "kiosk:market", kind: "kiosk", x: -266, y: 0, z: -69, rotation: Math.PI / 2, radius: 3, label: "City transit kiosk" });
  b.box(-266, 1.1, -69, 0.6, 1.1, 0.6, 0);
  b.interactive({ id: "board:market", kind: "board", x: -266, y: 0, z: -91, rotation: Math.PI / 2, radius: 3.5, label: "Agent Street board" });
  b.box(-266, 1.1, -91, 0.25, 1.1, 1.3, 0);
  return shops;
}

// -------------------------------------------------------------------------------------------------
// Coding Academy (zone-academy)
// -------------------------------------------------------------------------------------------------

/** Puzzle lab room (local space: open front at -depth/2, console near it, board toward the back). */
export const ACADEMY_LAB = {
  width: 22,
  depth: 20,
  height: 6,
  wall: 0.3,
  /** Width of the doorway in the front wall. */
  doorway: 6,
  /** Local z of the puzzle board's center, and the edge of one tile (8 tiles fit across). */
  boardZ: 2.6,
  tile: 1.5,
  /** Local z of the console and its interaction radius. */
  consoleZ: -6.4,
  consoleRadius: 3.4,
} as const;

/** Center line of the walkway from the Residential road (z = 80) to the lab. */
const ACADEMY_WALK_Z = 80;

function academyCampus(view: LayoutBuilderView): AcademyLab {
  const { b, rng } = view;
  const a = ACADEMY_ANNEX;
  const L = ACADEMY_LAB;
  const walk: Rect = { minX: a.minX + L.depth + 4, maxX: a.maxX, minZ: ACADEMY_WALK_Z - 5, maxZ: ACADEMY_WALK_Z + 5 };
  b.surface("grass", a, 0.02);
  b.surface("plaza", walk, 0.03);
  // A plaza in front of the lab, and paths north and south to the halls.
  const forecourt: Rect = { minX: a.minX + L.depth + 2, maxX: a.minX + L.depth + 22, minZ: ACADEMY_WALK_Z - 14, maxZ: ACADEMY_WALK_Z + 14 };
  b.surface("plaza", forecourt, 0.035);
  b.surface("path", { minX: -282, maxX: -276, minZ: a.minZ + 30, maxZ: walk.minZ }, 0.03);
  b.surface("path", { minX: -282, maxX: -276, minZ: walk.maxZ, maxZ: a.maxZ - 30 }, 0.03);

  // Puzzle lab on the west side, its open front facing east (+x) onto the forecourt.
  const rotation = -Math.PI / 2;
  const x = round(a.minX + 2 + L.depth / 2);
  const z = ACADEMY_WALK_Z;
  const local = (lx: number, lz: number) => {
    const [dx, dz] = rotY(lx, lz, rotation);
    return { x: round(x + dx), z: round(z + dz) };
  };
  const wallBox = (lx: number, lz: number, hx: number, hz: number, hy: number) => {
    const c = local(lx, lz);
    b.box(c.x, hy, c.z, hz, hy, hx);
  };
  // Back and side walls; the front wall has a doorway in the middle.
  wallBox(0, L.depth / 2 - L.wall / 2, L.width / 2, L.wall / 2, L.height / 2);
  for (const side of [-1, 1]) {
    wallBox(side * (L.width / 2 - L.wall / 2), 0, L.wall / 2, L.depth / 2, L.height / 2);
    const segment = (L.width - L.doorway) / 2;
    wallBox(side * (L.doorway / 2 + segment / 2), -L.depth / 2 + L.wall / 2, segment / 2, L.wall / 2, L.height / 2);
  }
  // The console: a small desk players walk up to.
  const consolePos = local(0, L.consoleZ);
  wallBox(0, L.consoleZ + 0.9, 0.8, 0.35, 0.55);
  b.interactive({
    id: "academy:lab",
    kind: "academyLab",
    x: consolePos.x,
    y: 0,
    z: consolePos.z,
    rotation: round(rotation),
    radius: L.consoleRadius,
    label: "Puzzle Lab console",
  });
  const board = local(0, L.boardZ);

  // Halls north and south of the walkway (closed for now: classrooms and the challenge arena).
  b.building({ x: -279, z: 22, width: 34, depth: 22, height: 12, rotation: Math.PI, facade: "hall", color: "#b9c7d6", roof: "flat", sign: "Coding Academy" });
  b.building({ x: -279, z: 140, width: 34, depth: 22, height: 10, rotation: 0, facade: "hall", color: "#c8bfd9", roof: "flat", sign: "Challenge Arena" });

  // Street furniture along the walkway and around the forecourt.
  for (let lx = walk.minX + 26; lx <= walk.maxX - 4; lx += 10) {
    b.prop("lamp", lx, walk.minZ + 0.8, 0);
    b.prop("lamp", lx + 5, walk.maxZ - 0.8, Math.PI);
  }
  for (const bx of [-286, -262]) {
    b.prop("bench", bx, walk.minZ - 1.6, 0);
    b.prop("bench", bx, walk.maxZ + 1.6, Math.PI);
  }
  b.prop("statue", forecourt.maxX - 4, ACADEMY_WALK_Z - 10, -Math.PI / 2);
  b.prop("flowerbed", forecourt.maxX - 4, ACADEMY_WALK_Z + 10, 0);
  const keepClear: Rect[] = [walk, forecourt, { minX: -284, maxX: -274, minZ: a.minZ, maxZ: a.maxZ }, { minX: -297, maxX: -261, minZ: a.minZ, maxZ: 36 }, { minX: -297, maxX: -261, minZ: 126, maxZ: a.maxZ }];
  b.scatterWith(rng, "tree", { minX: a.minX + 3, maxX: a.maxX - 3, minZ: a.minZ + 4, maxZ: a.maxZ - 4 }, 16, [...keepClear, { minX: a.minX, maxX: a.minX + L.depth + 3, minZ: z - L.width / 2 - 2, maxZ: z + L.width / 2 + 2 }], 8);

  // Transit kiosk and notice board where the walkway meets the city.
  b.interactive({ id: "kiosk:academy", kind: "kiosk", x: -256, y: 0, z: 71, rotation: Math.PI / 2, radius: 3, label: "City transit kiosk" });
  b.box(-256, 1.1, 71, 0.6, 1.1, 0.6, 0);
  b.interactive({ id: "board:academy", kind: "board", x: -256, y: 0, z: 89, rotation: Math.PI / 2, radius: 3.5, label: "Academy board" });
  b.box(-256, 1.1, 89, 0.25, 1.1, 1.3, 0);

  return {
    zoneId: zoneAt(x, z),
    chunk: chunkKeyAt(x, z),
    x,
    z,
    rotation: round(rotation),
    width: L.width,
    depth: L.depth,
    height: L.height,
    wall: L.wall,
    board: { x: board.x, z: board.z, tile: L.tile },
    console: { x: consolePos.x, z: consolePos.z, rotation: round(rotation) },
  };
}

let cached: CityLayout | null = null;

/** The canonical city layout (memoized). */
export function getCityLayout(): CityLayout {
  cached ??= generateCityLayout();
  return cached;
}

/** Converts plot-local coordinates (meters, local -Z = street side) to world coordinates. */
export function plotLocalToWorld(plot: Plot, lx: number, lz: number): { x: number; z: number } {
  const [dx, dz] = rotY(lx, lz, plot.rotation);
  return { x: plot.x + dx, z: plot.z + dz };
}

export function worldToPlotLocal(plot: Plot, x: number, z: number): { x: number; z: number } {
  const [lx, lz] = rotY(x - plot.x, z - plot.z, -plot.rotation);
  return { x: lx, z: lz };
}
