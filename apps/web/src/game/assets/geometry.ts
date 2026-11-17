import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Building, PropKind } from "@entroworld/world-assets";
import { FACADE_SPECS } from "./textures";

/**
 * Minimal geometry accumulator used to build merged, vertex-colored meshes for whole chunks.
 * Merging static geometry per material keeps draw calls low regardless of building count.
 */
export class GeometryBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private colors: number[] = [];
  private indices: number[] = [];

  get vertexCount(): number {
    return this.positions.length / 3;
  }

  /** Adds a quad from four corners (counter-clockwise when viewed from the front). */
  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    normal: THREE.Vector3,
    uv: [number, number, number, number],
    color: THREE.Color,
  ): void {
    const base = this.vertexCount;
    for (const p of [a, b, c, d]) {
      this.positions.push(p.x, p.y, p.z);
      this.normals.push(normal.x, normal.y, normal.z);
      this.colors.push(color.r, color.g, color.b);
    }
    const [u0, v0, u1, v1] = uv;
    this.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(): THREE.BufferGeometry | null {
    if (this.indices.length === 0) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.setIndex(this.indices);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const tmpColor = new THREE.Color();
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Adds an oriented box (side faces + top) to a builder.
 * Side UVs are in world meters divided by the facade tile size, so textures keep a constant scale.
 */
export function addBox(
  sides: GeometryBuilder | null,
  top: GeometryBuilder | null,
  opts: {
    x: number;
    z: number;
    y0: number;
    width: number;
    depth: number;
    height: number;
    rotation: number;
    color: THREE.Color;
    roofColor?: THREE.Color;
    tileWidth: number;
    tileHeight: number;
    /** Offset the v coordinate so the texture starts at a given height. */
    vOffset?: number;
  },
): void {
  const { x, z, y0, width, depth, height, rotation, color, tileWidth, tileHeight } = opts;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const tr = (lx: number, y: number, lz: number) => v(x + lx * cos + lz * sin, y, z - lx * sin + lz * cos);
  const rn = (nx: number, nz: number) => v(nx * cos + nz * sin, 0, -nx * sin + nz * cos);
  const hw = width / 2;
  const hd = depth / 2;
  const y1 = y0 + height;
  const vo = opts.vOffset ?? y0;
  const v0 = vo / tileHeight;
  const v1 = (vo + height) / tileHeight;
  if (sides) {
    // Front (-z), right (+x), back (+z), left (-x). Corners are listed bottom-left, bottom-right,
    // top-right, top-left as seen from outside, so triangles wind counter-clockwise outward.
    sides.quad(tr(hw, y0, -hd), tr(-hw, y0, -hd), tr(-hw, y1, -hd), tr(hw, y1, -hd), rn(0, -1), [0, v0, width / tileWidth, v1], color);
    sides.quad(tr(hw, y0, hd), tr(hw, y0, -hd), tr(hw, y1, -hd), tr(hw, y1, hd), rn(1, 0), [0, v0, depth / tileWidth, v1], color);
    sides.quad(tr(-hw, y0, hd), tr(hw, y0, hd), tr(hw, y1, hd), tr(-hw, y1, hd), rn(0, 1), [0, v0, width / tileWidth, v1], color);
    sides.quad(tr(-hw, y0, -hd), tr(-hw, y0, hd), tr(-hw, y1, hd), tr(-hw, y1, -hd), rn(-1, 0), [0, v0, depth / tileWidth, v1], color);
  }
  if (top) {
    top.quad(tr(-hw, y1, hd), tr(hw, y1, hd), tr(hw, y1, -hd), tr(-hw, y1, -hd), v(0, 1, 0), [0, 0, width / 8, depth / 8], opts.roofColor ?? color);
  }
}

export interface ChunkBuildingMeshes {
  /** Facade geometry per facade style. */
  facades: Map<string, THREE.BufferGeometry>;
  roofs: THREE.BufferGeometry | null;
  signs: THREE.BufferGeometry | null;
}

/** Builds merged geometry for a set of buildings (one chunk). */
export function buildChunkBuildings(
  buildings: Building[],
  signUv: Map<string, [number, number, number, number]>,
  detail: "high" | "low",
): ChunkBuildingMeshes {
  const facades = new Map<string, GeometryBuilder>();
  const roofs = new GeometryBuilder();
  const signs = new GeometryBuilder();
  const facadeBuilder = (style: string) => {
    let b = facades.get(style);
    if (!b) {
      b = new GeometryBuilder();
      facades.set(style, b);
    }
    return b;
  };
  for (const b of buildings) {
    const color = new THREE.Color(b.color);
    const roofColor = tmpColor.set("#8e8b84").clone().offsetHSL(0, 0, (hash(b.id) % 10) / 100 - 0.05);
    if (b.facade === "shop") {
      const lower = Math.min(7, b.height);
      const spec = FACADE_SPECS.shop;
      addBox(facadeBuilder("shop"), b.height <= 7.5 ? roofs : null, {
        x: b.x, z: b.z, y0: 0, width: b.width, depth: b.depth, height: lower, rotation: b.rotation,
        color, roofColor, tileWidth: spec.tileWidth, tileHeight: spec.tileHeight,
      });
      if (b.height > 7.5) {
        const up = FACADE_SPECS.stucco;
        addBox(facadeBuilder("stucco"), roofs, {
          x: b.x, z: b.z, y0: lower, width: b.width, depth: b.depth, height: b.height - lower, rotation: b.rotation,
          color: color.clone().offsetHSL(0, -0.05, 0.08), roofColor, tileWidth: up.tileWidth, tileHeight: up.tileHeight, vOffset: 0,
        });
      }
    } else if (b.setback) {
      const spec = FACADE_SPECS[b.facade];
      addBox(facadeBuilder(b.facade), roofs, {
        x: b.x, z: b.z, y0: 0, width: b.width, depth: b.depth, height: b.setback.height, rotation: b.rotation,
        color, roofColor, tileWidth: spec.tileWidth, tileHeight: spec.tileHeight,
      });
      addBox(facadeBuilder(b.facade), roofs, {
        x: b.x, z: b.z, y0: b.setback.height, width: b.width - b.setback.inset * 2, depth: b.depth - b.setback.inset * 2,
        height: b.height - b.setback.height, rotation: b.rotation, color, roofColor, tileWidth: spec.tileWidth, tileHeight: spec.tileHeight,
      });
    } else {
      const spec = FACADE_SPECS[b.facade];
      addBox(facadeBuilder(b.facade), roofs, {
        x: b.x, z: b.z, y0: 0, width: b.width, depth: b.depth, height: b.height, rotation: b.rotation,
        color, roofColor, tileWidth: spec.tileWidth, tileHeight: spec.tileHeight,
      });
    }

    if (detail === "high") {
      // Rooftop equipment.
      const top = b.setback ? b.height : b.height;
      const inset = b.setback ? b.setback.inset : 0;
      const h = hash(b.id);
      const units = 1 + (h % 3);
      for (let i = 0; i < units; i++) {
        const lx = (((h >> (i * 3)) % 7) / 7 - 0.5) * (b.width - inset * 2 - 4);
        const lz = (((h >> (i * 5)) % 5) / 5 - 0.5) * (b.depth - inset * 2 - 4);
        const cos = Math.cos(b.rotation);
        const sin = Math.sin(b.rotation);
        addBox(roofs, roofs, {
          x: b.x + lx * cos + lz * sin, z: b.z - lx * sin + lz * cos, y0: top, width: 2.2, depth: 1.6, height: 1.2 + (i % 2) * 0.8,
          rotation: b.rotation, color: tmpColor.set("#a9aaa6").clone(), roofColor: tmpColor.set("#9fa09c").clone(), tileWidth: 4, tileHeight: 4,
        });
      }
      // Parapet edge for flat roofs.
      const pw = b.setback ? b.width - b.setback.inset * 2 : b.width;
      const pd = b.setback ? b.depth - b.setback.inset * 2 : b.depth;
      const pc = color.clone().multiplyScalar(0.85);
      for (const [lx, lz, w, d] of [[0, -pd / 2 + 0.15, pw, 0.3], [0, pd / 2 - 0.15, pw, 0.3], [-pw / 2 + 0.15, 0, 0.3, pd], [pw / 2 - 0.15, 0, 0.3, pd]] as const) {
        const cos = Math.cos(b.rotation);
        const sin = Math.sin(b.rotation);
        addBox(roofs, roofs, {
          x: b.x + lx * cos + lz * sin, z: b.z - lx * sin + lz * cos, y0: top, width: w, depth: d, height: 0.7,
          rotation: b.rotation, color: pc, roofColor: pc, tileWidth: 4, tileHeight: 4,
        });
      }
      if (b.sign) {
        const uv = signUv.get(b.sign);
        if (uv) {
          const signW = Math.min(b.facade === "hall" ? 18 : 6.5, b.width - 1);
          const signH = b.facade === "hall" ? 2.6 : 0.95;
          const y0 = b.facade === "hall" ? b.height - 4 : 3.7;
          const cos = Math.cos(b.rotation);
          const sin = Math.sin(b.rotation);
          const lz = -b.depth / 2 - 0.06;
          const tr = (lx: number, y: number) => v(b.x + lx * cos + lz * sin, y, b.z - lx * sin + lz * cos);
          const normal = v(-sin, 0, -cos);
          signs.quad(tr(signW / 2, y0), tr(-signW / 2, y0), tr(-signW / 2, y0 + signH), tr(signW / 2, y0 + signH), normal, uv, new THREE.Color(1, 1, 1));
        }
      }
    }
  }
  const result = new Map<string, THREE.BufferGeometry>();
  for (const [style, builder] of facades) {
    const g = builder.build();
    if (g) result.set(style, g);
  }
  return { facades: result, roofs: roofs.build(), signs: signs.build() };
}

export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Prop geometries (vertex-colored, merged per kind, rendered with InstancedMesh)
// ---------------------------------------------------------------------------------------------

function colored(geometry: THREE.BufferGeometry, color: string, transform?: THREE.Matrix4): THREE.BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (transform) g.applyMatrix4(transform);
  const c = new THREE.Color(color);
  const count = g.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  // Keep only attributes shared by all parts so they can be merged.
  for (const name of Object.keys(g.attributes)) {
    if (!["position", "normal", "uv", "color"].includes(name)) g.deleteAttribute(name);
  }
  if (!g.getAttribute("uv")) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  return g;
}

const m4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
  new THREE.Matrix4().compose(v(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), v(sx, sy, sz));

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts, false);
  if (!merged) throw new Error("Failed to merge prop geometry");
  merged.computeBoundingSphere();
  return merged;
}

const propCache = new Map<string, THREE.BufferGeometry>();

/**
 * Geometry for each prop kind. `lod` "low" returns a much cheaper silhouette for distant chunks.
 * Parts drawn in white are tinted per-instance (e.g. umbrella and food truck colors).
 */
export function propGeometry(kind: PropKind, lod: "high" | "low" = "high"): THREE.BufferGeometry {
  const key = `${kind}:${lod}`;
  const hit = propCache.get(key);
  if (hit) return hit;
  let g: THREE.BufferGeometry;
  const low = lod === "low";
  switch (kind) {
    case "tree": {
      const trunk = colored(cyl(0.16, 0.26, 3.2, low ? 5 : 8), "#6b4a2f", m4(0, 1.6, 0));
      const leaves = low
        ? [colored(new THREE.IcosahedronGeometry(2.2, 0), "#4e7a34", m4(0, 4.4, 0, 0, 0, 0, 1, 1.15, 1))]
        : [
            colored(new THREE.IcosahedronGeometry(2.0, 1), "#4f7d33", m4(0, 4.2, 0, 0, 0, 0, 1, 1.05, 1)),
            colored(new THREE.IcosahedronGeometry(1.5, 1), "#5c8c3c", m4(0.9, 5.3, 0.4)),
            colored(new THREE.IcosahedronGeometry(1.4, 1), "#46722e", m4(-0.8, 5.0, -0.6)),
            colored(new THREE.IcosahedronGeometry(1.2, 1), "#5a8a3a", m4(0.1, 6.0, -0.2)),
          ];
      g = merge([trunk, ...leaves]);
      break;
    }
    case "palm": {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < (low ? 2 : 6); i++) {
        const t = i / (low ? 2 : 6);
        parts.push(colored(cyl(0.17 - t * 0.05, 0.2 - t * 0.05, low ? 2.6 : 0.95, 7), "#8a6f4e", m4(t * 0.6, 0.45 + t * 5.4, 0, 0, 0, -0.08)));
      }
      const leafCount = low ? 4 : 8;
      for (let i = 0; i < leafCount; i++) {
        const a = (i / leafCount) * Math.PI * 2;
        parts.push(colored(box(0.5, 0.05, 3.2), "#3f7d3a", m4(0.6 + Math.sin(a) * 1.4, 5.7, Math.cos(a) * 1.4, -0.35, a, 0)));
      }
      g = merge(parts);
      break;
    }
    case "bush":
      g = merge([colored(new THREE.IcosahedronGeometry(0.9, low ? 0 : 1), "#4a7430", m4(0, 0.55, 0, 0, 0, 0, 1.2, 0.8, 1.1))]);
      break;
    case "lamp": {
      const parts = [
        colored(cyl(0.07, 0.1, 6, 8), "#2f3337", m4(0, 3, 0)),
        colored(cyl(0.16, 0.2, 0.4, 8), "#2f3337", m4(0, 0.2, 0)),
      ];
      if (!low) {
        parts.push(colored(box(0.08, 0.08, 1.4), "#2f3337", m4(0, 5.9, -0.7)));
        parts.push(colored(box(0.36, 0.16, 0.6), "#2f3337", m4(0, 5.82, -1.35)));
        parts.push(colored(box(0.3, 0.04, 0.5), "#fff6d5", m4(0, 5.73, -1.35)));
      }
      g = merge(parts);
      break;
    }
    case "bench": {
      const wood = "#8a5a32";
      const metal = "#34383c";
      const parts = [
        colored(box(1.9, 0.07, 0.5), wood, m4(0, 0.45, 0)),
        colored(box(1.9, 0.4, 0.06), wood, m4(0, 0.75, 0.24, -0.15)),
      ];
      if (!low) {
        for (const x of [-0.8, 0.8]) {
          parts.push(colored(box(0.07, 0.45, 0.5), metal, m4(x, 0.22, 0)));
          parts.push(colored(box(0.07, 0.5, 0.06), metal, m4(x, 0.72, 0.25, -0.15)));
        }
      }
      g = merge(parts);
      break;
    }
    case "planter":
      g = merge([
        colored(box(1.8, 0.8, 1.8), "#9c9387", m4(0, 0.4, 0)),
        colored(new THREE.IcosahedronGeometry(0.85, low ? 0 : 1), "#4d7b35", m4(0, 1.05, 0, 0, 0, 0, 1, 0.6, 1)),
      ]);
      break;
    case "flowerbed": {
      const parts = [colored(cyl(2.4, 2.6, 0.4, 20), "#8d8579", m4(0, 0.2, 0)), colored(cyl(2.3, 2.3, 0.05, 20), "#4b6b2f", m4(0, 0.42, 0))];
      if (!low) {
        const flowers = ["#e63946", "#f4a261", "#e9c46a", "#ffffff", "#c77dff"];
        for (let i = 0; i < 26; i++) {
          const a = i * 2.4;
          const r = 0.4 + ((i * 7) % 18) / 10;
          parts.push(colored(new THREE.IcosahedronGeometry(0.16, 0), flowers[i % flowers.length]!, m4(Math.sin(a) * r, 0.55, Math.cos(a) * r)));
        }
      }
      g = merge(parts);
      break;
    }
    case "umbrella":
      g = merge([
        colored(cyl(0.035, 0.035, 2.4, 6), "#e8e8e8", m4(0, 1.2, 0)),
        colored(new THREE.ConeGeometry(1.6, 0.6, low ? 6 : 12, 1, true), "#ffffff", m4(0, 2.45, 0)),
      ]);
      break;
    case "lounger":
      g = merge([
        colored(box(0.7, 0.12, 1.9), "#d9d4c7", m4(0, 0.3, 0)),
        colored(box(0.66, 0.08, 0.6), "#3c8dbc", m4(0, 0.55, 0.7, -0.6)),
        colored(box(0.66, 0.06, 1.2), "#3c8dbc", m4(0, 0.39, -0.2)),
      ]);
      break;
    case "picnic":
      g = merge([
        colored(box(1.8, 0.07, 0.8), "#9a6b3f", m4(0, 0.75, 0)),
        colored(box(1.8, 0.06, 0.3), "#8a5d35", m4(0, 0.45, -0.65)),
        colored(box(1.8, 0.06, 0.3), "#8a5d35", m4(0, 0.45, 0.65)),
        colored(box(0.08, 0.75, 1.6), "#6f4a2a", m4(-0.7, 0.37, 0, 0.5)),
        colored(box(0.08, 0.75, 1.6), "#6f4a2a", m4(0.7, 0.37, 0, -0.5)),
      ]);
      break;
    case "trash":
      g = merge([colored(cyl(0.3, 0.27, 0.9, 10), "#3d5a40", m4(0, 0.45, 0))]);
      break;
    case "statue":
      g = merge([
        colored(box(2.8, 1.6, 2.8), "#bdb6a8", m4(0, 0.8, 0)),
        colored(new THREE.CapsuleGeometry(0.45, 1.5, 4, 10), "#7a5c3a", m4(0, 2.8, 0)),
        colored(new THREE.SphereGeometry(0.35, 10, 8), "#7a5c3a", m4(0, 4.05, 0)),
        colored(box(1.6, 0.18, 0.18), "#7a5c3a", m4(0.35, 3.4, 0, 0, 0, 0.7)),
      ]);
      break;
    case "lightTower": {
      const parts = [colored(box(0.5, 12, 0.5), "#3a3f44", m4(0, 6, 0)), colored(box(3, 1.6, 0.4), "#2a2d31", m4(0, 12.4, 0, 0.3))];
      if (!low) for (let i = 0; i < 6; i++) parts.push(colored(box(0.42, 0.42, 0.06), "#fff7d6", m4(-1.1 + (i % 3) * 1.1, 12.15 + Math.floor(i / 3) * 0.55, -0.25, 0.3)));
      g = merge(parts);
      break;
    }
    case "foodTruck": {
      const parts = [
        colored(box(5.4, 2.3, 2.3), "#ffffff", m4(0.3, 1.55, 0)),
        colored(box(1.6, 1.6, 2.2), "#ffffff", m4(-3, 1.2, 0)),
        colored(box(2.6, 0.9, 0.05), "#2b3a42", m4(0.4, 1.9, -1.16)),
        colored(box(2.8, 0.1, 0.7), "#d9d9d9", m4(0.4, 1.4, -1.45)),
      ];
      if (!low) for (const [x, z] of [[-2.4, -1.1], [-2.4, 1.1], [1.8, -1.1], [1.8, 1.1]] as const) parts.push(colored(cyl(0.42, 0.42, 0.3, 12), "#1c1c1c", m4(x, 0.42, z, Math.PI / 2)));
      g = merge(parts);
      break;
    }
    case "lifeguard":
      g = merge([
        colored(box(0.15, 2.4, 0.15), "#f1f1f1", m4(-1, 1.2, -1)),
        colored(box(0.15, 2.4, 0.15), "#f1f1f1", m4(1, 1.2, -1)),
        colored(box(0.15, 2.4, 0.15), "#f1f1f1", m4(-1, 1.2, 1)),
        colored(box(0.15, 2.4, 0.15), "#f1f1f1", m4(1, 1.2, 1)),
        colored(box(2.4, 1.4, 2.4), "#e63946", m4(0, 3.1, 0)),
        colored(new THREE.ConeGeometry(2, 0.8, 4), "#f1f1f1", m4(0, 4.2, 0, 0, Math.PI / 4)),
      ]);
      break;
    case "volleyNet":
      g = merge([
        colored(cyl(0.05, 0.05, 2.4, 6), "#dddddd", m4(-4.5, 1.2, 0)),
        colored(cyl(0.05, 0.05, 2.4, 6), "#dddddd", m4(4.5, 1.2, 0)),
        colored(box(9, 0.9, 0.02), "#f5f5f5", m4(0, 1.95, 0)),
      ]);
      break;
    default:
      g = merge([colored(box(1, 1, 1), "#ff00ff", m4(0, 0.5, 0))]);
  }
  propCache.set(key, g);
  return g;
}
