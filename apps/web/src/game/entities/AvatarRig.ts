import * as THREE from "three";
import type { AnimationState, AvatarConfig } from "@entroworld/shared";

/**
 * Procedural humanoid avatar. Built from primitives (no downloaded model files) and animated in
 * code: each frame a target pose is computed for the animation state and every joint eases toward
 * it, which gives smooth transitions between states without a blend tree.
 */

const geometryCache = new Map<string, THREE.BufferGeometry>();
const materialCache = new Map<string, THREE.MeshStandardMaterial>();

function geo(key: string, create: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geometryCache.get(key);
  if (!g) {
    g = create();
    geometryCache.set(key, g);
  }
  return g;
}

function mat(color: string, roughness = 0.75, metalness = 0): THREE.MeshStandardMaterial {
  const key = `${color}:${roughness}:${metalness}`;
  let m = materialCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    materialCache.set(key, m);
  }
  return m;
}

const capsule = (r: number, len: number) => geo(`cap:${r}:${len}`, () => new THREE.CapsuleGeometry(r, len, 4, 10));
const sphere = (r: number, w = 14, h = 10) => geo(`sph:${r}:${w}`, () => new THREE.SphereGeometry(r, w, h));
const boxG = (w: number, h: number, d: number) => geo(`box:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));

function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  me.position.set(x, y, z);
  me.castShadow = true;
  me.receiveShadow = false;
  return me;
}

interface Pose {
  hipsY: number;
  hipsZ: number;
  hipsRotY: number;
  hipsRotZ: number;
  torsoX: number;
  torsoY: number;
  torsoZ: number;
  headX: number;
  headY: number;
  uArmLX: number;
  uArmLZ: number;
  uArmRX: number;
  uArmRZ: number;
  lArmLX: number;
  lArmRX: number;
  lArmLY: number;
  lArmRY: number;
  thighLX: number;
  thighRX: number;
  thighLZ: number;
  thighRZ: number;
  shinLX: number;
  shinRX: number;
}

const HIP_HEIGHT = 0.95;

const restPose = (): Pose => ({
  hipsY: HIP_HEIGHT,
  hipsZ: 0,
  hipsRotY: 0,
  hipsRotZ: 0,
  torsoX: 0,
  torsoY: 0,
  torsoZ: 0,
  headX: 0,
  headY: 0,
  uArmLX: 0,
  uArmLZ: 0.08,
  uArmRX: 0,
  uArmRZ: -0.08,
  lArmLX: -0.12,
  lArmRX: -0.12,
  lArmLY: 0,
  lArmRY: 0,
  thighLX: 0,
  thighRX: 0,
  thighLZ: 0,
  thighRZ: 0,
  shinLX: 0,
  shinRX: 0,
});

const BODY_WIDTH: Record<string, number> = { slim: 0.32, regular: 0.38, broad: 0.46 };

export class AvatarRig {
  readonly root = new THREE.Group();
  private readonly detailed = new THREE.Group();
  private readonly low = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly uArmL = new THREE.Group();
  private readonly uArmR = new THREE.Group();
  private readonly lArmL = new THREE.Group();
  private readonly lArmR = new THREE.Group();
  private readonly thighL = new THREE.Group();
  private readonly thighR = new THREE.Group();
  private readonly shinL = new THREE.Group();
  private readonly shinR = new THREE.Group();
  private readonly pose: Pose = restPose();
  private readonly target: Pose = restPose();
  private phase = 0;
  private time = Math.random() * 10;
  private lod: 0 | 1 = 0;
  private configKey = "";

  constructor(config: AvatarConfig) {
    this.root.add(this.detailed, this.low);
    this.detailed.add(this.hips);
    this.hips.add(this.torso, this.thighL, this.thighR);
    this.thighL.add(this.shinL);
    this.thighR.add(this.shinR);
    this.uArmL.add(this.lArmL);
    this.uArmR.add(this.lArmR);
    this.low.visible = false;
    // The rig is modelled facing +Z; the game's forward at yaw 0 is -Z.
    this.detailed.rotation.y = Math.PI;
    this.low.rotation.y = Math.PI;
    this.setConfig(config);
  }

  setConfig(config: AvatarConfig): void {
    const key = JSON.stringify(config);
    if (key === this.configKey) return;
    this.configKey = key;
    for (const g of [this.torso, this.head, this.uArmL, this.uArmR, this.lArmL, this.lArmR, this.thighL, this.thighR, this.shinL, this.shinR, this.low]) {
      for (const child of [...g.children]) if (!(child instanceof THREE.Group)) g.remove(child);
    }
    this.build(config);
  }

  private build(c: AvatarConfig): void {
    const skin = mat(c.appearance.skinTone, 0.65);
    const top = mat(c.clothing.topColor, c.clothing.top === "jacket" ? 0.55 : 0.85);
    const bottom = mat(c.clothing.bottomColor, 0.85);
    const shoes = mat(c.clothing.shoesColor, 0.6);
    const hair = mat(c.appearance.hairColor, 0.9);
    const dark = mat("#1b1b1f", 0.4);
    const w = BODY_WIDTH[c.appearance.bodyType] ?? 0.38;

    // Torso: pivot at the hips, extends upward.
    const torsoLen = 0.5;
    const torsoMesh = mesh(capsule(w / 2.1, torsoLen - w / 2), top, 0, torsoLen / 2 + 0.04, 0);
    torsoMesh.scale.set(1, 1, 0.62);
    this.torso.add(torsoMesh);
    // Pelvis in the bottom color.
    const pelvis = mesh(capsule(w / 2.2, 0.06), c.clothing.bottom === "skirt" ? bottom : bottom, 0, 0.02, 0);
    pelvis.scale.set(1, 1, 0.65);
    this.torso.add(pelvis);
    if (c.clothing.top === "jacket" || c.clothing.top === "blazer") {
      const inner = mesh(boxG(w * 0.28, torsoLen * 0.62, 0.02), mat(c.clothing.top === "blazer" ? "#f5f5f4" : "#2a2a2e", 0.8), 0, torsoLen * 0.62, w * 0.33);
      this.torso.add(inner);
    }
    if (c.clothing.top === "hoodie") {
      const hood = mesh(sphere(0.14, 12, 8), top, 0, torsoLen + 0.1, -0.08);
      hood.scale.set(1.1, 0.7, 0.9);
      this.torso.add(hood);
    }
    // Neck and head.
    this.torso.add(mesh(capsule(0.05, 0.06), skin, 0, torsoLen + 0.05, 0));
    this.head.position.set(0, torsoLen + 0.2, 0);
    this.torso.add(this.head);
    const headMesh = mesh(sphere(0.125), skin, 0, 0, 0);
    headMesh.scale.set(0.95, 1.08, 1);
    this.head.add(headMesh);
    for (const side of [-1, 1]) {
      this.head.add(mesh(sphere(0.018, 8, 6), dark, side * 0.042, 0.02, 0.112));
      this.head.add(mesh(sphere(0.022, 8, 6), skin, side * 0.122, 0, 0));
    }
    this.head.add(mesh(sphere(0.02, 8, 6), skin, 0, -0.012, 0.125));
    this.buildHair(c.appearance.hairStyle, hair);
    this.buildAccessories(c, top, dark, hair);

    // Arms: pivot at the shoulders.
    const shoulderY = torsoLen - 0.04;
    const shoulderX = w / 2 + 0.05;
    this.uArmL.position.set(-shoulderX, shoulderY, 0);
    this.uArmR.position.set(shoulderX, shoulderY, 0);
    if (!this.uArmL.parent) this.torso.add(this.uArmL, this.uArmR);
    const sleeveUpper = c.clothing.top === "tank" ? skin : top;
    const sleeveLower = c.clothing.top === "tank" || c.clothing.top === "tshirt" ? skin : top;
    for (const [upper, lower] of [[this.uArmL, this.lArmL], [this.uArmR, this.lArmR]] as const) {
      upper.add(mesh(capsule(0.052, 0.2), sleeveUpper, 0, -0.14, 0));
      lower.position.set(0, -0.29, 0);
      lower.add(mesh(capsule(0.045, 0.18), sleeveLower, 0, -0.13, 0));
      lower.add(mesh(sphere(0.05, 10, 8), skin, 0, -0.29, 0.01));
    }

    // Legs: pivot at the hip joints.
    const hipX = w * 0.26;
    this.thighL.position.set(-hipX, 0, 0);
    this.thighR.position.set(hipX, 0, 0);
    const shorts = c.clothing.bottom === "shorts";
    const skirt = c.clothing.bottom === "skirt";
    for (const [thigh, shin] of [[this.thighL, this.shinL], [this.thighR, this.shinR]] as const) {
      thigh.add(mesh(capsule(0.075, 0.3), skirt ? skin : bottom, 0, -0.22, 0));
      shin.position.set(0, -0.45, 0);
      shin.add(mesh(capsule(0.06, 0.3), shorts || skirt ? skin : bottom, 0, -0.2, 0));
      const boot = c.clothing.shoes === "boots";
      const sandal = c.clothing.shoes === "sandals";
      if (boot) shin.add(mesh(capsule(0.068, 0.12), shoes, 0, -0.33, 0));
      const foot = mesh(boxG(0.11, sandal ? 0.03 : 0.08, 0.24), shoes, 0, sandal ? -0.47 : -0.45, 0.05);
      shin.add(foot);
      if (sandal) shin.add(mesh(boxG(0.1, 0.05, 0.18), skin, 0, -0.43, 0.05));
    }
    if (shorts) {
      for (const thigh of [this.thighL, this.thighR]) {
        const cuff = mesh(capsule(0.082, 0.1), bottom, 0, -0.12, 0);
        thigh.add(cuff);
      }
    }
    if (skirt) {
      const sk = mesh(geo("skirt", () => new THREE.CylinderGeometry(w * 0.45, w * 0.68, 0.38, 14, 1, true)), bottom, 0, -0.14, 0);
      (sk.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
      this.torso.add(sk);
    }

    // Low-detail silhouette used beyond the LOD distance.
    const lowBody = mesh(capsule(0.22, 1.1), top, 0, 0.8, 0);
    lowBody.castShadow = false;
    const lowHead = mesh(sphere(0.13, 8, 6), skin, 0, 1.62, 0);
    lowHead.castShadow = false;
    const lowLegs = mesh(capsule(0.16, 0.5), bottom, 0, 0.4, 0);
    lowLegs.castShadow = false;
    this.low.add(lowBody, lowHead, lowLegs);
    this.hips.position.y = HIP_HEIGHT;
  }

  private buildHair(style: string, hair: THREE.Material): void {
    const add = (g: THREE.BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
      const m = mesh(g, hair, x, y, z);
      m.scale.set(sx, sy, sz);
      this.head.add(m);
    };
    switch (style) {
      case "bald":
        return;
      case "buzz":
        add(sphere(0.129), 0, 0.012, -0.004, 0.97, 0.98, 1.0);
        return;
      case "short":
        add(sphere(0.135), 0, 0.03, -0.012, 1.0, 0.92, 1.02);
        return;
      case "curly":
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          add(sphere(0.055, 8, 6), Math.sin(a) * 0.1, 0.07 + Math.cos(i) * 0.02, Math.cos(a) * 0.09 - 0.02);
        }
        add(sphere(0.12), 0, 0.06, -0.01);
        return;
      case "long":
        add(sphere(0.137), 0, 0.03, -0.012, 1.02, 0.95, 1.03);
        add(boxG(0.25, 0.32, 0.08), 0, -0.11, -0.08);
        return;
      case "bun":
        add(sphere(0.133), 0, 0.03, -0.012, 1, 0.92, 1.02);
        add(sphere(0.06), 0, 0.12, -0.1);
        return;
      case "ponytail":
        add(sphere(0.133), 0, 0.03, -0.012, 1, 0.92, 1.02);
        add(capsule(0.04, 0.18), 0, -0.06, -0.15, 1, 1, 1);
        return;
      case "mohawk":
        add(boxG(0.04, 0.09, 0.24), 0, 0.13, -0.01);
        add(sphere(0.128), 0, 0.005, -0.004, 0.96, 0.95, 0.99);
        return;
      case "afro":
        add(sphere(0.2), 0, 0.07, -0.03, 1, 0.92, 1);
        return;
      default:
        add(sphere(0.135), 0, 0.03, -0.012, 1, 0.92, 1.02);
    }
  }

  private buildAccessories(c: AvatarConfig, top: THREE.Material, dark: THREE.Material, hair: THREE.Material): void {
    void hair;
    for (const a of c.accessories) {
      switch (a) {
        case "glasses":
        case "sunglasses": {
          const m = a === "sunglasses" ? mat("#0b0b0e", 0.2, 0.3) : mat("#33302c", 0.4);
          for (const side of [-1, 1]) {
            const lens = mesh(boxG(0.06, 0.035, 0.012), a === "sunglasses" ? m : mat("#cfe3f0", 0.1, 0.1), side * 0.045, 0.022, 0.123);
            this.head.add(lens);
            this.head.add(mesh(boxG(0.065, 0.008, 0.012), m, side * 0.045, 0.042, 0.124));
          }
          this.head.add(mesh(boxG(0.03, 0.008, 0.01), m, 0, 0.03, 0.126));
          break;
        }
        case "cap": {
          const crown = mesh(geo("capCrown", () => new THREE.SphereGeometry(0.138, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), top, 0, 0.035, -0.01);
          this.head.add(crown);
          this.head.add(mesh(boxG(0.17, 0.012, 0.11), top, 0, 0.04, 0.15));
          break;
        }
        case "beanie": {
          const b = mesh(geo("beanie", () => new THREE.SphereGeometry(0.14, 14, 8, 0, Math.PI * 2, 0, Math.PI / 1.8)), mat("#9b2c2c", 0.95), 0, 0.03, -0.01);
          b.scale.set(1, 1.15, 1);
          this.head.add(b);
          break;
        }
        case "headphones": {
          const band = mesh(geo("hpBand", () => new THREE.TorusGeometry(0.14, 0.012, 6, 18, Math.PI)), dark, 0, 0.0, 0);
          this.head.add(band);
          for (const side of [-1, 1]) this.head.add(mesh(capsule(0.035, 0.02), dark, side * 0.135, -0.01, 0));
          break;
        }
        case "backpack":
          this.torso.add(mesh(boxG(0.28, 0.34, 0.14), mat("#3f4a3c", 0.9), 0, 0.3, -0.17));
          break;
        case "scarf": {
          const s = mesh(geo("scarf", () => new THREE.TorusGeometry(0.09, 0.035, 8, 16)), mat("#c2410c", 0.95), 0, 0.5, 0);
          s.rotation.x = Math.PI / 2;
          this.torso.add(s);
          break;
        }
        case "earrings":
          for (const side of [-1, 1]) this.head.add(mesh(sphere(0.012, 6, 4), mat("#d4af37", 0.3, 0.9), side * 0.125, -0.035, 0.005));
          break;
      }
    }
  }

  /** Switches between the detailed rig (0) and the low-detail silhouette (1). */
  setLod(level: 0 | 1): void {
    if (level === this.lod) return;
    this.lod = level;
    this.detailed.visible = level === 0;
    this.low.visible = level === 1;
  }

  /**
   * Advances the animation.
   * @param speed horizontal speed in m/s (drives walk cycle frequency)
   */
  update(dt: number, state: AnimationState, speed: number, emote: string): void {
    this.time += dt;
    if (this.lod === 1) {
      this.low.position.y = state === "SITTING" ? -0.35 : 0;
      return;
    }
    const t = this.time;
    const p = Object.assign(this.target, restPose());

    switch (state) {
      case "WALKING":
      case "RUNNING": {
        const run = state === "RUNNING";
        const freq = run ? 1.55 : 1.85;
        this.phase += dt * Math.max(2, speed) * freq;
        const s = Math.sin(this.phase);
        const amp = run ? 0.85 : 0.55;
        p.thighLX = s * amp;
        p.thighRX = -s * amp;
        p.shinLX = Math.max(0, -Math.cos(this.phase)) * (run ? 1.4 : 0.8);
        p.shinRX = Math.max(0, Math.cos(this.phase)) * (run ? 1.4 : 0.8);
        p.uArmLX = -s * amp * 0.9;
        p.uArmRX = s * amp * 0.9;
        p.lArmLX = run ? -1.3 : -0.35;
        p.lArmRX = run ? -1.3 : -0.35;
        p.hipsY = HIP_HEIGHT - 0.02 + Math.abs(Math.cos(this.phase)) * (run ? 0.07 : 0.035);
        p.torsoX = run ? 0.22 : 0.05;
        p.hipsRotY = s * 0.08;
        p.torsoY = -s * 0.12;
        break;
      }
      case "JUMPING":
        p.thighLX = 0.7;
        p.thighRX = 0.2;
        p.shinLX = 1.1;
        p.shinRX = 0.5;
        p.uArmLX = 2.6;
        p.uArmRX = 2.4;
        p.uArmLZ = 0.4;
        p.uArmRZ = -0.4;
        break;
      case "FALLING":
        p.thighLX = 0.35;
        p.thighRX = -0.1;
        p.shinLX = 0.6;
        p.shinRX = 0.4;
        p.uArmLZ = 1.25 + Math.sin(t * 9) * 0.15;
        p.uArmRZ = -1.25 - Math.sin(t * 9) * 0.15;
        break;
      case "SITTING":
        p.hipsY = 0.55;
        p.hipsZ = -0.12;
        p.thighLX = 1.5;
        p.thighRX = 1.5;
        p.thighLZ = 0.06;
        p.thighRZ = -0.06;
        p.shinLX = 1.45;
        p.shinRX = 1.45;
        p.uArmLX = 0.35;
        p.uArmRX = 0.35;
        p.lArmLX = -0.9;
        p.lArmRX = -0.9;
        p.torsoX = -0.05 + Math.sin(t * 1.4) * 0.01;
        p.headX = Math.sin(t * 0.4) * 0.05;
        p.headY = Math.sin(t * 0.23) * 0.25;
        break;
      case "EMOTING":
        this.emotePose(p, emote, t);
        break;
      default: {
        // Idle: subtle breathing and weight shift.
        const b = Math.sin(t * 1.7);
        p.hipsY = HIP_HEIGHT - 0.005 + b * 0.004;
        p.torsoX = b * 0.012;
        p.uArmLZ = 0.1 + b * 0.02;
        p.uArmRZ = -0.1 - b * 0.02;
        p.headY = Math.sin(t * 0.31) * 0.18;
        p.hipsRotZ = Math.sin(t * 0.5) * 0.015;
        break;
      }
    }

    const k = 1 - Math.exp(-dt * (state === "WALKING" || state === "RUNNING" ? 18 : 10));
    const cur = this.pose as unknown as Record<string, number>;
    const tgt = p as unknown as Record<string, number>;
    for (const key of Object.keys(tgt)) cur[key] = cur[key]! + (tgt[key]! - cur[key]!) * k;
    this.applyPose();
  }

  private emotePose(p: Pose, emote: string, t: number): void {
    switch (emote) {
      case "wave":
        p.uArmRZ = -2.7;
        p.lArmRY = 0;
        p.lArmRX = -0.3 + Math.sin(t * 10) * 0.35;
        p.uArmRX = Math.sin(t * 10) * 0.12;
        break;
      case "dance": {
        const s = Math.sin(t * 7);
        p.hipsRotZ = s * 0.12;
        p.hipsY = HIP_HEIGHT - 0.04 + Math.abs(s) * 0.05;
        p.uArmLZ = 1.8 + s * 0.5;
        p.uArmRZ = -1.8 + s * 0.5;
        p.lArmLX = -1.2;
        p.lArmRX = -1.2;
        p.torsoY = Math.sin(t * 3.5) * 0.4;
        p.thighLX = Math.max(0, s) * 0.5;
        p.thighRX = Math.max(0, -s) * 0.5;
        p.shinLX = Math.max(0, s) * 0.7;
        p.shinRX = Math.max(0, -s) * 0.7;
        break;
      }
      case "cheer": {
        const b = Math.abs(Math.sin(t * 6));
        p.uArmLZ = 2.7;
        p.uArmRZ = -2.7;
        p.hipsY = HIP_HEIGHT + b * 0.08;
        p.lArmLX = -0.2;
        p.lArmRX = -0.2;
        break;
      }
      case "clap": {
        const c = Math.sin(t * 14);
        p.uArmLX = 1.1;
        p.uArmRX = 1.1;
        p.uArmLZ = -0.35 - c * 0.15;
        p.uArmRZ = 0.35 + c * 0.15;
        p.lArmLX = -0.6;
        p.lArmRX = -0.6;
        break;
      }
      case "laugh":
        p.torsoX = -0.25 + Math.sin(t * 16) * 0.05;
        p.headX = -0.3;
        p.uArmLX = 0.4;
        p.uArmRX = 0.4;
        p.lArmLX = -1.3;
        p.lArmRX = -1.3;
        break;
      case "think":
        p.uArmRX = 0.9;
        p.uArmRZ = 0.15;
        p.lArmRX = -2.2;
        p.uArmLX = 0.4;
        p.lArmLX = -1.4;
        p.headX = 0.15;
        p.headY = Math.sin(t * 0.8) * 0.1;
        break;
      case "shrug":
        p.uArmLZ = 0.5;
        p.uArmRZ = -0.5;
        p.lArmLX = -1.4;
        p.lArmRX = -1.4;
        p.lArmLY = -0.7;
        p.lArmRY = 0.7;
        p.headX = 0.1;
        p.torsoZ = Math.sin(t * 2) * 0.03;
        break;
      case "bow":
        p.torsoX = 0.85;
        p.headX = 0.2;
        p.uArmLX = 0.2;
        p.uArmRX = 0.2;
        break;
      default:
        break;
    }
  }

  private applyPose(): void {
    const p = this.pose;
    this.hips.position.set(0, p.hipsY, p.hipsZ);
    this.hips.rotation.set(0, p.hipsRotY, p.hipsRotZ);
    this.torso.rotation.set(p.torsoX, p.torsoY, p.torsoZ);
    this.head.rotation.set(p.headX, p.headY, 0);
    // Conventions: positive X = limb swings forward; positive Z = arm raised away from the body.
    this.uArmL.rotation.set(-p.uArmLX, 0, -p.uArmLZ);
    this.uArmR.rotation.set(-p.uArmRX, 0, -p.uArmRZ);
    this.lArmL.rotation.set(p.lArmLX, p.lArmLY, 0);
    this.lArmR.rotation.set(p.lArmRX, p.lArmRY, 0);
    this.thighL.rotation.set(-p.thighLX, 0, -p.thighLZ);
    this.thighR.rotation.set(-p.thighRX, 0, -p.thighRZ);
    // Positive knee bend moves the foot backward.
    this.shinL.rotation.set(p.shinLX, 0, 0);
    this.shinR.rotation.set(p.shinRX, 0, 0);
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
