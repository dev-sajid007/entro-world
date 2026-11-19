import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Low-poly but realistic car models for the city's traffic, built from side profiles. Model space:
 * the car faces +z, x is its width, wheels stand on y = 0.
 */
export interface ModelSpec {
  /** Shown on the car and its label, e.g. "Velora". */
  label: string;
  kind: string;
  length: number;
  width: number;
  /** Bottom of the body between the wheels. */
  sill: number;
  /** Height of the hood at the front, and of the body's top edge (window line). */
  nose: number;
  belt: number;
  roof: number;
  /** z where the windshield starts and ends, and where the rear window ends and starts. */
  windshieldBase: number;
  windshieldTop: number;
  rearTop: number;
  rearBase: number;
  wheelRadius: number;
  /** Wheel centres along z (rear, front). */
  axles: [number, number];
}

export const MODELS = {
  sedan: { label: "Velora", kind: "Sedan", length: 4.6, width: 1.82, sill: 0.3, nose: 0.76, belt: 0.98, roof: 1.43, windshieldBase: 1.0, windshieldTop: 0.18, rearTop: -0.98, rearBase: -1.65, wheelRadius: 0.34, axles: [-1.4, 1.42] },
  suv: { label: "Strider", kind: "SUV", length: 4.7, width: 1.92, sill: 0.44, nose: 1.02, belt: 1.2, roof: 1.8, windshieldBase: 1.08, windshieldTop: 0.42, rearTop: -2.08, rearBase: -2.22, wheelRadius: 0.4, axles: [-1.48, 1.48] },
  van: { label: "Voyager", kind: "Van", length: 5.0, width: 1.98, sill: 0.4, nose: 1.0, belt: 1.16, roof: 2.08, windshieldBase: 1.8, windshieldTop: 1.08, rearTop: -2.4, rearBase: -2.45, wheelRadius: 0.38, axles: [-1.65, 1.65] },
} satisfies Record<string, ModelSpec>;

export type ModelName = keyof typeof MODELS;
export const MODEL_ORDER: ModelName[] = ["sedan", "suv", "van"];

const box = (w: number, h: number, l: number, x: number, y: number, z: number) => clean(new THREE.BoxGeometry(w, h, l).translate(x, y, z));

/** Non-indexed with position and normal only, so any parts can be merged. */
function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(out.attributes)) if (name !== "position" && name !== "normal") out.deleteAttribute(name);
  return out;
}

const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map(clean))!;

/** Extrudes a side profile (x = car z, y = up) across `width`, centred, with rounded edges. */
function extrudeProfile(shape: THREE.Shape, width: number, bevel: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 5, curveSegments: 16 });
  g.rotateY(-Math.PI / 2);
  g.translate((width - bevel * 2) / 2, 0, 0);
  g.computeVertexNormals();
  return g;
}

export interface CarModel {
  spec: ModelSpec;
  /** Painted body, roof and pillars. */
  paint: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  /** Black plastic: bumpers, grille, window surrounds, door seams, chassis. */
  trim: THREE.BufferGeometry;
  /** Bright metal: grille frame, door handles, badge strip. */
  chrome: THREE.BufferGeometry;
  headlights: THREE.BufferGeometry;
  taillights: THREE.BufferGeometry;
  /** One wheel at the origin (axis along x), and where the four go. */
  tire: THREE.BufferGeometry;
  rim: THREE.BufferGeometry;
  wheels: { x: number; y: number; z: number; front: boolean; side: -1 | 1 }[];
  /** Number plate anchors (plane facing out of the car), and the rear name badge. */
  plates: { front: THREE.Vector3; rear: THREE.Vector3 };
  badge: THREE.Vector3;
}

export function buildModel(m: ModelSpec): CarModel {
  const half = m.length / 2;
  const [rearAxle, frontAxle] = m.axles;
  const arch = m.wheelRadius + 0.07;

  // Body: rear bumper, along the bottom with wheel arches, up the nose, over the hood, along the
  // window line and down the back.
  const body = new THREE.Shape();
  body.moveTo(-half, m.sill + 0.14);
  body.quadraticCurveTo(-half, m.sill, -half + 0.14, m.sill);
  body.lineTo(rearAxle - arch, m.sill);
  body.absarc(rearAxle, m.wheelRadius, arch, Math.PI, 0, true);
  body.lineTo(frontAxle - arch, m.sill);
  body.absarc(frontAxle, m.wheelRadius, arch, Math.PI, 0, true);
  body.lineTo(half - 0.14, m.sill);
  body.quadraticCurveTo(half, m.sill, half, m.sill + 0.16);
  body.quadraticCurveTo(half + 0.05, m.nose - 0.12, half - 0.18, m.nose);
  // A gently curved hood up to the windshield.
  body.quadraticCurveTo((half + m.windshieldBase) / 2, m.belt + 0.02, m.windshieldBase, m.belt);
  body.lineTo(m.rearBase, m.belt);
  body.quadraticCurveTo(-half + 0.02, m.belt - 0.01, -half, m.belt - 0.22);
  body.lineTo(-half, m.sill + 0.14);

  // Glass house: windshield, slightly arched roof line and rear window.
  const cabin = new THREE.Shape();
  cabin.moveTo(m.windshieldBase, m.belt - 0.02);
  cabin.quadraticCurveTo(m.windshieldBase - 0.15, (m.belt + m.roof) / 2 + 0.05, m.windshieldTop, m.roof - 0.03);
  cabin.quadraticCurveTo((m.windshieldTop + m.rearTop) / 2, m.roof + 0.04, m.rearTop, m.roof - 0.03);
  cabin.lineTo(m.rearBase, m.belt - 0.02);
  cabin.lineTo(m.windshieldBase, m.belt - 0.02);

  const cabinW = m.width - 0.18;
  const glass = extrudeProfile(cabin, cabinW, 0.06);

  // Roof panel and pillars in body colour, so the glass reads as separate windows.
  const roofLen = Math.max(0.4, m.windshieldTop - m.rearTop - 0.2);
  const roofMid = (m.windshieldTop + m.rearTop) / 2;
  const pillarH = m.roof - m.belt;
  const bPillarZ = m.windshieldTop - (m.windshieldTop - m.rearTop) * 0.42;
  const pillars = [box(cabinW + 0.02, pillarH - 0.04, 0.12, 0, m.belt + pillarH / 2, bPillarZ)];
  // Vans and SUVs have a second pillar behind the rear doors.
  if (m.rearTop - m.rearBase > -0.3) pillars.push(box(cabinW + 0.02, pillarH - 0.04, 0.14, 0, m.belt + pillarH / 2, m.rearTop + 0.25));
  const paint = merge([extrudeProfile(body, m.width, 0.12), box(m.width - 0.26, 0.07, roofLen, 0, m.roof, roofMid), ...pillars]);

  // Black trim: bumpers, grille, window surrounds, door seams, chassis (hides the see-through arches).
  const seam = (z: number) => [-1, 1].map((s) => box(0.012, m.belt - m.sill - 0.12, 0.02, s * (m.width / 2 + 0.002), (m.belt + m.sill) / 2, z));
  const trim = merge([
    box(m.width - 0.06, 0.2, 0.16, 0, m.sill + 0.1, half - 0.02),
    box(m.width - 0.06, 0.2, 0.16, 0, m.sill + 0.1, -half + 0.02),
    box(m.width * 0.5, m.nose - m.sill - 0.42, 0.05, 0, m.sill + 0.3 + (m.nose - m.sill - 0.42) / 2, half + 0.005),
    box(m.width - 0.32, 0.18, m.length - 0.6, 0, 0.32, 0),
    // Rubber strip along the bottom of the windows.
    ...[-1, 1].map((s) => box(0.03, 0.04, m.windshieldBase - m.rearBase - 0.1, s * (cabinW / 2 + 0.01), m.belt + 0.01, (m.windshieldBase + m.rearBase) / 2)),
    ...seam(bPillarZ),
    ...seam(m.windshieldBase - 0.05),
    ...(m.rearTop - m.rearBase > -0.3 ? seam(m.rearTop + 0.25) : seam(m.rearBase + 0.15)),
    // Side mirrors on short arms.
    ...[-1, 1].map((s) => box(0.24, 0.14, 0.12, s * (m.width / 2 + 0.12), m.belt + 0.1, m.windshieldBase - 0.15)),
  ]);

  const chrome = merge([
    // Grille frame.
    box(m.width * 0.52, 0.025, 0.06, 0, m.nose - 0.1, half + 0.01),
    box(m.width * 0.52, 0.025, 0.06, 0, m.sill + 0.3, half + 0.01),
    // Door handles.
    ...[-1, 1].flatMap((s) => [bPillarZ + 0.35, bPillarZ - 0.45].map((z) => box(0.03, 0.035, 0.18, s * (m.width / 2 + 0.01), m.belt - 0.12, z))),
  ]);

  const lampY = m.nose - 0.12;
  const headlights = merge([-1, 1].map((s) => box(0.42, 0.12, 0.08, s * (m.width / 2 - 0.3), lampY, half - 0.08)));
  const tailY = m.belt - 0.2;
  const taillights = merge([
    ...[-1, 1].map((s) => box(0.42, 0.14, 0.06, s * (m.width / 2 - 0.27), tailY, -half + 0.01)),
    // A thin light bar across the back.
    box(m.width - 0.9, 0.03, 0.04, 0, tailY + 0.04, -half + 0.005),
  ]);

  // A tyre with rounded shoulders (lathe profile) and a five-spoke rim.
  const r = m.wheelRadius;
  const tw = 0.26;
  const profile = [
    new THREE.Vector2(r * 0.66, -tw / 2),
    new THREE.Vector2(r * 0.9, -tw / 2),
    new THREE.Vector2(r, -tw / 2 + 0.04),
    new THREE.Vector2(r, tw / 2 - 0.04),
    new THREE.Vector2(r * 0.9, tw / 2),
    new THREE.Vector2(r * 0.66, tw / 2),
  ];
  const tire = clean(new THREE.LatheGeometry(profile, 24).rotateZ(Math.PI / 2));
  const spokes = Array.from({ length: 5 }, (_, i) => {
    const a = (i / 5) * Math.PI * 2;
    return clean(new THREE.BoxGeometry(0.04, r * 0.56, 0.07).translate(0, r * 0.32, 0).rotateX(a).translate(tw / 2 - 0.05, 0, 0));
  });
  const rim = merge([
    clean(new THREE.CylinderGeometry(r * 0.66, r * 0.66, tw - 0.06, 20, 1, true).rotateZ(Math.PI / 2)),
    clean(new THREE.CylinderGeometry(r * 0.12, r * 0.12, tw - 0.02, 10).rotateZ(Math.PI / 2)),
    ...spokes,
  ]);
  const wx = m.width / 2 - 0.17;
  const wheels = ([[-1, rearAxle], [1, rearAxle], [-1, frontAxle], [1, frontAxle]] as const).map(([side, z]) => ({ x: side * wx, y: r, z, front: z > 0, side }));

  return {
    spec: m,
    paint,
    glass,
    trim,
    chrome,
    headlights,
    taillights,
    tire,
    rim,
    wheels,
    plates: { front: new THREE.Vector3(0, m.sill + 0.12, half + 0.11), rear: new THREE.Vector3(0, m.sill + 0.12, -half - 0.07) },
    badge: new THREE.Vector3(0, tailY + 0.16, -half - 0.01),
  };
}
