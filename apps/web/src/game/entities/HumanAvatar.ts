import * as THREE from "three";
import { resolveBodyShape } from "@entroworld/avatar";
import type { AnimationState, AvatarConfig } from "@entroworld/shared";
import { cloneSkinned, type AvatarAssets, type BodyAsset, type BodyShape } from "../assets/avatarAssets";
import { addAccessories } from "./ProceduralAvatar";

/**
 * Realistic avatar: a skinned, motion-captured human body (Quaternius, CC0) dressed by a shader.
 *
 * The free bodies come without clothes, so clothing is painted onto the skin in the fragment
 * shader using each vertex's bind-pose position: everything between the waist and the collar is the
 * top (sleeves end at a distance along the T-posed arm), waist to hem is the bottom, below the ankle
 * are shoes. Because it uses the bind pose, the clothing follows the body through every animation.
 */

const HAIR_FOR_STYLE: Record<string, Partial<Record<BodyShape, string>> & { any?: string }> = {
  bald: {},
  buzz: { masculine: "buzz", feminine: "buzz-f" },
  short: { any: "short" },
  curly: { any: "short" },
  long: { any: "long" },
  bun: { any: "buns" },
  ponytail: { any: "long" },
  mohawk: { masculine: "buzz", feminine: "buzz-f" },
  afro: { any: "buns" },
};

const BODY_WIDTH: Record<string, number> = { slim: 0.93, regular: 1, broad: 1.08 };

/** Average skin color of the light body textures (measured); skin tones are expressed relative to it. */
const SKIN_REFERENCE = new THREE.Color("#a87552");

const SLEEVE = { none: 0, short: 0.45, long: 0.93 } as const;
const TOP_STYLE: Record<string, { sleeve: number; neckDrop: number; open: number; inner: string | null; hem: number; roughness: number }> = {
  tshirt: { sleeve: SLEEVE.short, neckDrop: 0.03, open: 0, inner: null, hem: 0, roughness: 0.9 },
  tank: { sleeve: SLEEVE.none, neckDrop: 0.07, open: 0, inner: null, hem: 0, roughness: 0.9 },
  hoodie: { sleeve: SLEEVE.long, neckDrop: 0.01, open: 0, inner: null, hem: 1, roughness: 0.95 },
  sweater: { sleeve: SLEEVE.long, neckDrop: 0.015, open: 0, inner: null, hem: 1, roughness: 0.97 },
  jacket: { sleeve: SLEEVE.long, neckDrop: 0.05, open: 1, inner: "#2a2a2e", hem: 0, roughness: 0.6 },
  blazer: { sleeve: SLEEVE.long, neckDrop: 0.08, open: 1, inner: "#f5f5f4", hem: 0, roughness: 0.75 },
};

const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const AXIS_X = new THREE.Vector3(1, 0, 0);
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);

interface Landmarks {
  neckY: number;
  waistY: number;
  kneeY: number;
  ankleY: number;
  shoulderX: number;
  wristX: number;
  /** Center of the head, model space. */
  headCenter: THREE.Vector3;
  /** Head radius relative to the procedural rig's (0.125). */
  headScale: number;
}

export class HumanAvatar {
  readonly root = new THREE.Group();
  /** Turned to face the game's forward (-Z); offsets for sitting are applied here. */
  private readonly holder = new THREE.Group();
  private readonly model: THREE.Object3D;
  private readonly body: BodyAsset;
  readonly shape: BodyShape;
  private readonly mixer: THREE.AnimationMixer;
  private readonly bones = new Map<string, THREE.Object3D>();
  private readonly marks: Landmarks;
  private readonly bodyMaterial: THREE.MeshStandardMaterial;
  private readonly browMaterial: THREE.MeshStandardMaterial | null = null;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly extras: THREE.Object3D[] = [];
  private readonly headAnchor: THREE.Object3D;
  private readonly torsoAnchor: THREE.Object3D;
  private readonly hipAnchor: THREE.Object3D;
  private readonly sideR: number;
  private current: THREE.AnimationAction | null = null;
  private currentName = "";
  private prevState: AnimationState = "IDLE";
  private emoteWeight = 0;
  private lastEmote = "";
  private sitBlend = 0;
  private time = Math.random() * 10;
  private configKey = "";

  constructor(
    private readonly assets: AvatarAssets,
    config: AvatarConfig,
  ) {
    this.shape = resolveBodyShape(config);
    this.body = assets.bodies[this.shape];
    this.model = cloneSkinned(this.body.scene);
    this.holder.rotation.y = Math.PI;
    this.holder.add(this.model);
    this.root.add(this.holder);
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) this.bones.set(o.name, o);
    });
    this.model.updateMatrixWorld(true);
    this.marks = this.measure();
    this.sideR = Math.sign(this.worldPos("upperarm_r").x) || -1;

    // Materials: one per avatar (colors differ); textures stay shared.
    this.uniforms = {
      uDqScale: { value: new THREE.Vector3(1, 1, 1) },
      uDqOffset: { value: new THREE.Vector3() },
      uSkinTint: { value: new THREE.Color(1, 1, 1) },
      uTop: { value: new THREE.Color() },
      uTopInner: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uShoes: { value: new THREE.Color() },
      uNeckY: { value: this.marks.neckY },
      uWaistY: { value: this.marks.waistY },
      uShoulderX: { value: this.marks.shoulderX },
      uSleeveX: { value: 0 },
      uNeckDrop: { value: 0 },
      uOpen: { value: 0 },
      uHem: { value: 0 },
      uTopRough: { value: 0.9 },
      uBottomEnd: { value: 0 },
      uDenim: { value: 0 },
      uShoeTop: { value: 0 },
      uSole: { value: 0 },
      uSandal: { value: 0 },
    };
    let bodyMaterial: THREE.MeshStandardMaterial | null = null;
    let bodyMesh: THREE.SkinnedMesh | null = null;
    let browMaterial: THREE.MeshStandardMaterial | null = null;
    this.model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      const m = (mesh.material as THREE.MeshStandardMaterial).clone();
      mesh.material = m;
      if (m.name === "Body") {
        bodyMaterial = m;
        bodyMesh = mesh;
      } else if (m.name === "Brows") browMaterial = m;
    });
    if (!bodyMaterial) throw new Error("Avatar body material missing");
    if (bodyMesh) {
      const dq = this.dequantization(bodyMesh);
      (this.uniforms.uDqScale!.value as THREE.Vector3).copy(dq.scale);
      (this.uniforms.uDqOffset!.value as THREE.Vector3).copy(dq.offset);
    }
    this.bodyMaterial = bodyMaterial;
    this.browMaterial = browMaterial;
    this.installClothingShader(this.bodyMaterial);

    this.headAnchor = this.anchor("Head", this.marks.headCenter, this.marks.headScale);
    const hips = this.worldPos("pelvis");
    this.torsoAnchor = this.anchor("spine_02", hips, 0.95);
    this.hipAnchor = this.anchor("pelvis", hips, 0.95);

    this.mixer = new THREE.AnimationMixer(this.model);
    this.play("Idle_Loop", 0);
    this.setConfig(config);
  }

  // -----------------------------------------------------------------------------------------------
  // Appearance
  // -----------------------------------------------------------------------------------------------

  setConfig(c: AvatarConfig): void {
    const key = JSON.stringify(c);
    if (key === this.configKey) return;
    this.configKey = key;
    const u = this.uniforms;
    const skin = new THREE.Color(c.appearance.skinTone);
    (u.uSkinTint!.value as THREE.Color).setRGB(skin.r / SKIN_REFERENCE.r, skin.g / SKIN_REFERENCE.g, skin.b / SKIN_REFERENCE.b);

    const top = TOP_STYLE[c.clothing.top] ?? TOP_STYLE.tshirt!;
    const { shoulderX, wristX, kneeY, ankleY } = this.marks;
    (u.uTop!.value as THREE.Color).set(c.clothing.topColor);
    (u.uTopInner!.value as THREE.Color).set(top.inner ?? c.clothing.topColor);
    u.uSleeveX!.value = top.sleeve === 0 ? shoulderX - 0.015 : shoulderX + (wristX - shoulderX) * top.sleeve;
    u.uNeckDrop!.value = top.neckDrop;
    u.uOpen!.value = top.open;
    u.uHem!.value = top.hem;
    u.uTopRough!.value = top.roughness;

    (u.uBottom!.value as THREE.Color).set(c.clothing.bottomColor);
    const b = c.clothing.bottom;
    u.uBottomEnd!.value = b === "shorts" ? kneeY + 0.07 : b === "skirt" ? kneeY + 0.03 : ankleY + 0.03;
    u.uDenim!.value = b === "jeans" ? 1 : 0;

    (u.uShoes!.value as THREE.Color).set(c.clothing.shoesColor);
    const s = c.clothing.shoes;
    u.uShoeTop!.value = s === "boots" ? ankleY + 0.13 : s === "loafers" ? ankleY + 0.012 : s === "sandals" ? 0.022 : ankleY + 0.025;
    u.uSole!.value = s === "sneakers" ? 1 : 0;
    u.uSandal!.value = s === "sandals" ? 1 : 0;

    this.browMaterial?.color.set(c.appearance.hairColor);
    this.root.scale.set(BODY_WIDTH[c.appearance.bodyType] ?? 1, 1, BODY_WIDTH[c.appearance.bodyType] ?? 1);
    this.rebuildExtras(c);
  }

  private rebuildExtras(c: AvatarConfig): void {
    for (const o of this.extras) {
      o.removeFromParent();
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.ownMaterial) (mesh.material as THREE.Material).dispose();
    }
    this.extras.length = 0;
    const track = (parent: THREE.Object3D) => {
      const before = new Set(parent.children);
      return () => parent.children.filter((ch) => !before.has(ch)).forEach((ch) => this.extras.push(ch));
    };

    // Hair, parented to the Head bone (the geometry is already in Head-bone space).
    const pick = HAIR_FOR_STYLE[c.appearance.hairStyle] ?? HAIR_FOR_STYLE.short!;
    const hairId = pick[this.shape] ?? pick.any;
    const hair = hairId ? this.assets.hair.get(hairId) : undefined;
    const head = this.bones.get("Head");
    if (hair && head) {
      const m = hair.material.clone();
      m.color.set(c.appearance.hairColor);
      const mesh = new THREE.Mesh(hair.geometry, m);
      mesh.matrixAutoUpdate = false;
      mesh.matrix.copy(hair.matrix);
      mesh.userData.ownMaterial = true;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      head.add(mesh);
      this.extras.push(mesh);
    }

    // Accessories and clothing extras reuse the procedural pieces, placed on anchors that match
    // the procedural rig's head and torso frames.
    const topMat = new THREE.MeshStandardMaterial({ color: c.clothing.topColor, roughness: 0.9 });
    const dark = new THREE.MeshStandardMaterial({ color: "#1b1b1f", roughness: 0.4 });
    const doneHead = track(this.headAnchor);
    const doneTorso = track(this.torsoAnchor);
    addAccessories(c, this.headAnchor, this.torsoAnchor, topMat, dark);
    if (c.clothing.top === "hoodie") {
      const hood = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), topMat);
      hood.position.set(0, 0.56, -0.11);
      hood.scale.set(1.15, 0.6, 0.85);
      hood.castShadow = true;
      this.torsoAnchor.add(hood);
    }
    doneHead();
    doneTorso();
    if (c.clothing.bottom === "skirt") {
      const skirtMat = new THREE.MeshStandardMaterial({ color: c.clothing.bottomColor, roughness: 0.9, side: THREE.DoubleSide });
      const skirt = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.25, 0.34, 18, 1, true), skirtMat);
      skirt.position.set(0, -0.12, 0);
      skirt.userData.ownMaterial = true;
      skirt.castShadow = true;
      this.hipAnchor.add(skirt);
      this.extras.push(skirt);
    }
    for (const o of this.extras) {
      o.traverse((ch) => {
        ch.frustumCulled = false;
      });
    }
  }

  private installClothingShader(material: THREE.MeshStandardMaterial): void {
    const uniforms = this.uniforms;
    material.customProgramCacheKey = () => "ew-human-clothing-v1";
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vBindPos;\nuniform vec3 uDqScale, uDqOffset;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvBindPos = position * uDqScale + uDqOffset;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${CLOTHING_GLSL}`)
        .replace("#include <map_fragment>", "#include <map_fragment>\nfloat ewCloth = 0.0;\ndiffuseColor.rgb = ewDress(diffuseColor.rgb, ewCloth);")
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, ewClothRough, ewCloth);")
        .replace("#include <normal_fragment_maps>", "vec3 ewBaseNormal = normal;\n#include <normal_fragment_maps>\nnormal = normalize(mix(normal, ewBaseNormal, ewCloth * 0.85));");
    };
    material.needsUpdate = true;
  }

  /**
   * Compressed meshes store positions in a normalized space and fold the scale/offset back in via
   * the inverse bind matrices. The clothing shader works in metres, so recover that mapping per
   * axis by fitting each bone's bind position in geometry space against its position in metres.
   */
  private dequantization(mesh: THREE.SkinnedMesh): { scale: THREE.Vector3; offset: THREE.Vector3 } {
    const q: THREE.Vector3[] = [];
    const m: THREE.Vector3[] = [];
    mesh.skeleton.bones.forEach((bone, i) => {
      const inv = mesh.skeleton.boneInverses[i];
      if (!inv) return;
      q.push(new THREE.Vector3().setFromMatrixPosition(inv.clone().invert()));
      m.push(this.worldPos(bone.name));
    });
    const scale = new THREE.Vector3(1, 1, 1);
    const offset = new THREE.Vector3();
    for (const axis of ["x", "y", "z"] as const) {
      const n = q.length;
      const mq = q.reduce((a, v) => a + v[axis], 0) / n;
      const mm = m.reduce((a, v) => a + v[axis], 0) / n;
      let num = 0;
      let den = 0;
      for (let i = 0; i < n; i++) {
        num += (q[i]![axis] - mq) * (m[i]![axis] - mm);
        den += (q[i]![axis] - mq) ** 2;
      }
      const s = den > 1e-9 ? num / den : 1;
      scale[axis] = s;
      offset[axis] = mm - s * mq;
    }
    return { scale, offset };
  }

  // -----------------------------------------------------------------------------------------------
  // Skeleton helpers
  // -----------------------------------------------------------------------------------------------

  private worldPos(bone: string): THREE.Vector3 {
    const out = new THREE.Vector3();
    this.bones.get(bone)?.getWorldPosition(out);
    return this.model.worldToLocal(out);
  }

  private measure(): Landmarks {
    const y = (b: string) => this.worldPos(b).y;
    const x = (b: string) => Math.abs(this.worldPos(b).x);
    const neck = this.worldPos("neck_01");
    const head = this.worldPos("Head");
    // Head center: above the Head bone (skull base), a little forward.
    let eyeBox: THREE.Box3 | null = null;
    this.model.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!eyeBox && mesh.isSkinnedMesh && (mesh.material as THREE.Material).name === "Eyes") {
        mesh.geometry.computeBoundingBox();
        // Geometry is stored quantized; map its bounds back to metres.
        const { scale, offset } = this.dequantization(mesh);
        const b = mesh.geometry.boundingBox!;
        const lo = b.min.clone().multiply(scale).add(offset);
        const hi = b.max.clone().multiply(scale).add(offset);
        eyeBox = new THREE.Box3().setFromPoints([lo, hi]);
      }
    });
    // The procedural head has its eyes 0.084 apart, 0.112 in front of and 0.02 above its center.
    const box = eyeBox as THREE.Box3 | null;
    const eyeSpacing = box ? box.max.x - box.min.x - 0.025 : 0.072;
    const headScale = eyeSpacing / 0.084;
    const center = box ? box.getCenter(new THREE.Vector3()).add(new THREE.Vector3(0, -0.02 * headScale, -0.112 * headScale)) : head.clone().add(new THREE.Vector3(0, 0.09, 0.02));
    return {
      neckY: (neck.y + head.y) / 2 - 0.035,
      waistY: y("pelvis") + 0.11,
      kneeY: y("calf_l"),
      ankleY: y("foot_l"),
      shoulderX: x("upperarm_l"),
      wristX: x("hand_l"),
      headCenter: center,
      headScale,
    };
  }

  /** An object on `bone` whose origin is at `pos` (model space, bind pose) with the model's axes. */
  private anchor(bone: string, pos: THREE.Vector3, scale: number): THREE.Object3D {
    const anchor = new THREE.Group();
    const b = this.bones.get(bone);
    if (!b) {
      this.model.add(anchor);
      anchor.position.copy(pos);
      return anchor;
    }
    const toModel = new THREE.Matrix4().copy(this.model.matrixWorld).invert().multiply(b.matrixWorld);
    const local = toModel.invert().multiply(new THREE.Matrix4().compose(pos, new THREE.Quaternion(), new THREE.Vector3(scale, scale, scale)));
    local.decompose(anchor.position, anchor.quaternion, anchor.scale);
    b.add(anchor);
    return anchor;
  }

  /** Rotates a bone about an axis given in model space (character facing +Z, Y up). */
  private rotate(name: string, axis: THREE.Vector3, angle: number): void {
    if (Math.abs(angle) < 1e-4) return;
    const bone = this.bones.get(name);
    const parent = bone?.parent;
    if (!bone || !parent) return;
    // Parent orientation in model space.
    parent.getWorldQuaternion(tmpQ);
    this.model.getWorldQuaternion(tmpQ2).invert();
    tmpQ.premultiply(tmpQ2);
    // local delta = P^-1 * R * P
    tmpQ2.setFromAxisAngle(axis, angle).premultiply(tmpQ.clone().invert()).multiply(tmpQ);
    bone.quaternion.premultiply(tmpQ2);
  }

  /** Raises an arm bone sideways, away from the body (negative = across the body). */
  private raise(name: string, side: number, angle: number): void {
    this.rotate(name, AXIS_Z, side * angle);
  }

  // -----------------------------------------------------------------------------------------------
  // Animation
  // -----------------------------------------------------------------------------------------------

  private play(name: string, fade = 0.2, once = false): THREE.AnimationAction | null {
    if (name === this.currentName) return this.current;
    const clip = this.body.clips.get(name);
    if (!clip) return this.current;
    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = once;
    action.timeScale = 1;
    action.play();
    if (this.current && fade > 0) this.current.crossFadeTo(action, fade, false);
    else if (this.current) this.current.stop();
    this.current = action;
    this.currentName = name;
    return action;
  }

  update(dt: number, state: AnimationState, speed: number, emote: string): void {
    this.time += dt;
    const t = this.time;
    const finished = this.current && this.current.loop === THREE.LoopOnce && this.current.time >= this.current.getClip().duration - 1e-3;

    switch (state) {
      case "WALKING":
      case "RUNNING": {
        // A plain walk for walking and a real run for running: the run clip is animated for about
        // the game's run speed (8.25 vs 8.4 m/s), so it plays at its natural pace and the feet
        // don't slide. The game's walk is brisk (4.4 m/s), so the walk plays faster than its natural pace.
        const run = state === "RUNNING";
        const name = run ? "Sprint_Loop" : "Walk_Loop";
        const action = this.play(name, 0.18);
        const natural = this.body.clipSpeed.get(name) ?? (run ? 8.25 : 1);
        if (action) action.timeScale = THREE.MathUtils.clamp(Math.max(speed, 0.5) / natural, run ? 0.6 : 0.7, run ? 1.4 : 2.2);
        break;
      }
      case "JUMPING":
        if (this.prevState !== "JUMPING") {
          const a = this.play("Jump_Start", 0.08, true);
          if (a) {
            a.time = 0.35; // Skip the crouch: the game jump starts immediately.
            a.timeScale = 1.6;
          }
        } else if (finished) this.play("Jump_Loop", 0.15);
        break;
      case "FALLING":
        this.play("Jump_Loop", 0.2);
        break;
      case "SITTING":
        this.play(emote === "talk" ? "Sitting_Talking_Loop" : "Sitting_Idle_Loop", 0.3);
        break;
      case "EMOTING":
        if (emote === "dance") this.play("Dance_Loop", 0.25);
        else if (emote === "talk") this.play("Idle_Talking_Loop", 0.3);
        else this.play("Idle_Loop", 0.25);
        break;
      default:
        if ((this.prevState === "FALLING" || this.prevState === "JUMPING") && this.currentName.startsWith("Jump")) {
          const a = this.play("Jump_Land", 0.08, true);
          if (a) a.timeScale = 1.8;
        } else if (this.currentName !== "Jump_Land" || finished) this.play("Idle_Loop", 0.3);
    }
    this.prevState = state;
    this.mixer.update(dt);

    // Seated: line the clip's hips up with where the procedural rig sits (0.55 up, 0.12 back).
    const sitting = state === "SITTING";
    this.sitBlend += ((sitting ? 1 : 0) - this.sitBlend) * (1 - Math.exp(-dt * 8));
    const sp = this.body.sitPelvis;
    this.model.position.set(0, (0.55 - sp.y) * this.sitBlend, (-0.12 - sp.z) * this.sitBlend);

    // Procedural emotes layered on the idle clip.
    const overlay = state === "EMOTING" && emote !== "dance" && emote !== "talk" ? emote : "";
    if (overlay) this.lastEmote = overlay;
    this.emoteWeight += ((overlay ? 1 : 0) - this.emoteWeight) * (1 - Math.exp(-dt * 9));
    this.holder.position.y = 0;
    if (this.emoteWeight > 0.01 && this.lastEmote) this.emotePose(this.lastEmote, this.emoteWeight, t);
  }

  private emotePose(emote: string, w: number, t: number): void {
    const R = this.sideR;
    const L = -R;
    switch (emote) {
      case "wave":
        this.raise("upperarm_r", R, 2.45 * w);
        this.raise("lowerarm_r", R, (0.15 + Math.sin(t * 10) * 0.38) * w);
        this.rotate("lowerarm_r", AXIS_X, -0.3 * w);
        break;
      case "cheer":
        this.raise("upperarm_l", L, 2.6 * w);
        this.raise("upperarm_r", R, 2.6 * w);
        this.raise("lowerarm_l", L, 0.15 * w);
        this.raise("lowerarm_r", R, 0.15 * w);
        this.holder.position.y = Math.abs(Math.sin(t * 6)) * 0.08 * w;
        break;
      case "clap": {
        const c = Math.sin(t * 14);
        for (const [side, s] of [["l", L], ["r", R]] as const) {
          this.rotate(`upperarm_${side}`, AXIS_X, -0.95 * w);
          this.raise(`upperarm_${side}`, s, -0.3 * w);
          this.rotate(`lowerarm_${side}`, AXIS_X, -0.7 * w);
          this.raise(`lowerarm_${side}`, s, (-0.45 - c * 0.18) * w);
        }
        break;
      }
      case "laugh":
        this.rotate("spine_02", AXIS_X, (-0.18 + Math.sin(t * 16) * 0.05) * w);
        this.rotate("Head", AXIS_X, -0.25 * w);
        for (const [side, s] of [["l", L], ["r", R]] as const) {
          this.rotate(`upperarm_${side}`, AXIS_X, -0.3 * w);
          this.rotate(`lowerarm_${side}`, AXIS_X, -1.1 * w);
          this.raise(`lowerarm_${side}`, s, -0.4 * w);
        }
        break;
      case "think":
        this.rotate("upperarm_r", AXIS_X, -0.75 * w);
        this.raise("upperarm_r", R, -0.2 * w);
        this.rotate("lowerarm_r", AXIS_X, -2.0 * w);
        this.rotate("upperarm_l", AXIS_X, -0.35 * w);
        this.rotate("lowerarm_l", AXIS_X, -1.3 * w);
        this.raise("lowerarm_l", L, -0.6 * w);
        this.rotate("Head", AXIS_X, 0.12 * w);
        this.rotate("Head", AXIS_Y, Math.sin(t * 0.8) * 0.1 * w);
        break;
      case "shrug":
        for (const [side, s] of [["l", L], ["r", R]] as const) {
          this.raise(`clavicle_${side}`, s, 0.18 * w);
          this.raise(`upperarm_${side}`, s, 0.3 * w);
          this.rotate(`lowerarm_${side}`, AXIS_X, -1.2 * w);
          this.raise(`lowerarm_${side}`, s, 0.55 * w);
        }
        this.rotate("Head", AXIS_Z, 0.12 * w);
        break;
      case "bow":
        this.rotate("spine_01", AXIS_X, 0.45 * w);
        this.rotate("spine_02", AXIS_X, 0.3 * w);
        this.rotate("Head", AXIS_X, 0.25 * w);
        break;
      case "listen":
        this.rotate("Head", AXIS_X, (0.06 + Math.max(0, Math.sin(t * 1.6)) * 0.1) * w);
        this.rotate("Head", AXIS_Y, Math.sin(t * 0.4) * 0.08 * w);
        break;
      default:
        break;
    }
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const o of this.extras) {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.userData.ownMaterial) (mesh.material as THREE.Material).dispose();
    }
    this.bodyMaterial.dispose();
    this.browMaterial?.dispose();
    this.root.removeFromParent();
  }
}

/** Fragment helpers: decide per pixel whether it's skin or which garment, from the bind pose. */
const CLOTHING_GLSL = /* glsl */ `
varying vec3 vBindPos;
uniform vec3 uSkinTint, uTop, uTopInner, uBottom, uShoes;
uniform float uNeckY, uWaistY, uShoulderX, uSleeveX, uNeckDrop, uOpen, uHem, uTopRough;
uniform float uBottomEnd, uDenim, uShoeTop, uSole, uSandal;
float ewClothRough = 0.9;

float ewHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float ewNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(ewHash(i), ewHash(i + vec3(1,0,0)), f.x), mix(ewHash(i + vec3(0,1,0)), ewHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(ewHash(i + vec3(0,0,1)), ewHash(i + vec3(1,0,1)), f.x), mix(ewHash(i + vec3(0,1,1)), ewHash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float ewBand(float lo, float hi, float v) {
  float aa = 0.004;
  return smoothstep(lo - aa, lo + aa, v) * (1.0 - smoothstep(hi - aa, hi + aa, v));
}

vec3 ewDress(vec3 base, out float cloth) {
  vec3 p = vBindPos;
  float ax = abs(p.x);
  float arm = smoothstep(uShoulderX - 0.01, uShoulderX + 0.04, ax);
  // Collar dips at the front for scoop/v necks.
  float collar = uNeckY - uNeckDrop * smoothstep(0.0, 0.06, p.z) * (1.0 - smoothstep(0.03, 0.09, ax));
  float topTorso = ewBand(uWaistY - 0.03, collar, p.y);
  float topArm = 1.0 - smoothstep(uSleeveX - 0.004, uSleeveX + 0.004, ax);
  float top = mix(topTorso, ewBand(uWaistY, uNeckY + 0.2, p.y), arm) * topArm;
  float bottom = ewBand(uBottomEnd, uWaistY, p.y) * (1.0 - arm);
  float shoes = 1.0 - smoothstep(uShoeTop - 0.004, uShoeTop + 0.004, p.y);
  shoes = max(shoes, uSandal * ewBand(0.05, 0.065, p.y));
  shoes *= 1.0 - arm;

  float grain = 0.94 + 0.06 * ewNoise(p * 180.0);
  vec3 topCol = uTop;
  // Open jacket/blazer front shows the shirt underneath.
  topCol = mix(topCol, uTopInner, uOpen * (1.0 - arm) * step(0.0, p.z) * (1.0 - smoothstep(0.022, 0.03, ax)) * step(uWaistY + 0.02, p.y));
  // Ribbed hem on sweaters and hoodies.
  topCol *= 1.0 - uHem * 0.18 * ewBand(uWaistY - 0.03, uWaistY + 0.01, p.y) * (1.0 - arm);
  topCol *= 1.0 - uHem * 0.18 * smoothstep(uSleeveX - 0.03, uSleeveX - 0.02, ax) * arm;
  vec3 bottomCol = uBottom * (1.0 - uDenim * 0.12 * step(0.5, fract((p.x + p.y) * 260.0)));
  vec3 shoeCol = mix(uShoes, vec3(0.92), uSole * (1.0 - smoothstep(0.018, 0.024, p.y)));

  vec3 col = base * uSkinTint;
  col = mix(col, bottomCol * grain, bottom);
  col = mix(col, topCol * grain, top);
  col = mix(col, shoeCol, shoes);
  cloth = max(max(top, bottom), shoes);
  ewClothRough = mix(0.85, uTopRough, top) * (1.0 - shoes) + 0.5 * shoes;
  return col;
}
`;
