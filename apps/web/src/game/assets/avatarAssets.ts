import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { clone as cloneSkeleton } from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * Realistic avatar assets (Quaternius Universal Base Characters + Universal Animation Library,
 * CC0), converted by infra/scripts/build-avatars.mjs into /public/avatars. Loaded once, on first
 * use, and shared by every avatar in the scene.
 */

export type BodyShape = "masculine" | "feminine";

export interface BodyAsset {
  /** The original scene; instances are made with SkeletonUtils.clone. */
  scene: THREE.Group;
  /** Clips adjusted to this body's hip height, keyed by clip name. */
  clips: Map<string, THREE.AnimationClip>;
  /** Ground speed (m/s) at which each locomotion clip's feet don't slide, measured from the feet. */
  clipSpeed: Map<string, number>;
  /** Pelvis position (model space) in the seated clip, to line the hips up with seats. */
  sitPelvis: THREE.Vector3;
}

export interface HairAsset {
  /** Geometry plus `matrix` (which also undoes mesh quantization) place the hair in Head-bone space. */
  geometry: THREE.BufferGeometry;
  matrix: THREE.Matrix4;
  /** Grayscale base color + normal map; clone it and set `color` per avatar. */
  material: THREE.MeshStandardMaterial;
  fits: BodyShape;
}

export interface AvatarAssets {
  bodies: Record<BodyShape, BodyAsset>;
  hair: Map<string, HairAsset>;
}

interface Manifest {
  version: string;
  bodies: Record<BodyShape, { file: string }>;
  hair: Record<string, { file: string; fits: BodyShape }>;
  clips: Record<string, { speed: number; duration: number }>;
}

const BASE = "/avatars/";

let assets: AvatarAssets | null = null;
let loading: Promise<AvatarAssets> | null = null;
const waiting = new Set<(a: AvatarAssets) => void>();

/** The loaded assets, or null while loading (or if loading failed). */
export function getAvatarAssets(): AvatarAssets | null {
  return assets;
}

/** Calls `cb` once the assets are ready (immediately if they already are). Returns an unsubscribe. */
export function whenAvatarAssets(cb: (a: AvatarAssets) => void): () => void {
  if (assets) {
    cb(assets);
    return () => undefined;
  }
  waiting.add(cb);
  void loadAvatarAssets().catch(() => undefined);
  return () => waiting.delete(cb);
}

export function loadAvatarAssets(): Promise<AvatarAssets> {
  loading ??= load().then(
    (a) => {
      assets = a;
      for (const cb of waiting) cb(a);
      waiting.clear();
      return a;
    },
    (e: unknown) => {
      console.warn("[avatars] realistic avatars unavailable, using classic ones", e);
      waiting.clear();
      throw e;
    },
  );
  return loading;
}

async function load(): Promise<AvatarAssets> {
  const res = await fetch(`${BASE}manifest.json`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
  const manifest = (await res.json()) as Manifest;
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const get = (file: string) => loader.loadAsync(`${BASE}${file}?v=${manifest.version}`);

  const [masculine, feminine, anims, ...hairGltfs] = await Promise.all([
    get(manifest.bodies.masculine.file),
    get(manifest.bodies.feminine.file),
    get("animations.glb"),
    ...Object.values(manifest.hair).map((h) => get(h.file)),
  ]);

  const hair = new Map<string, HairAsset>();
  Object.entries(manifest.hair).forEach(([style, h], i) => {
    const mesh = findMesh(hairGltfs[i]!.scene);
    if (!mesh) return;
    hairGltfs[i]!.scene.updateMatrixWorld(true);
    hair.set(style, { geometry: mesh.geometry, matrix: mesh.matrixWorld.clone(), material: mesh.material as THREE.MeshStandardMaterial, fits: h.fits });
  });

  const animPelvis = restPelvisHeight(anims.scene);
  const body = (gltf: GLTF): BodyAsset => {
    prepareBody(gltf.scene);
    const ratio = animPelvis > 0 ? restPelvisHeight(gltf.scene) / animPelvis : 1;
    const clips = new Map(anims.animations.map((c) => [c.name, fitClip(c, ratio)]));
    return { scene: gltf.scene, clips, ...measure(gltf.scene, clips) };
  };

  return { bodies: { masculine: body(masculine), feminine: body(feminine) }, hair };
}

export const LOCOMOTION_CLIPS = ["Walk_Loop"] as const;

/**
 * Plays clips on a throwaway copy of the body to measure (a) how fast a planted foot moves
 * backward in each locomotion clip, which is the ground speed the clip was animated for, and
 * (b) where the hips are when seated.
 */
function measure(scene: THREE.Object3D, clips: Map<string, THREE.AnimationClip>): { clipSpeed: Map<string, number>; sitPelvis: THREE.Vector3 } {
  const model = cloneSkinned(scene);
  const mixer = new THREE.AnimationMixer(model);
  const feet = [model.getObjectByName("foot_l"), model.getObjectByName("foot_r")].filter((f): f is THREE.Object3D => !!f);
  const pelvis = model.getObjectByName("pelvis");
  const p = new THREE.Vector3();
  const clipSpeed = new Map<string, number>();

  for (const name of LOCOMOTION_CLIPS) {
    const clip = clips.get(name);
    if (!clip || feet.length < 2) continue;
    mixer.stopAllAction();
    const action = mixer.clipAction(clip).play();
    const steps = 60;
    const samples = feet.map(() => [] as { y: number; z: number }[]);
    for (let i = 0; i <= steps; i++) {
      action.time = (clip.duration * i) / steps;
      mixer.update(0);
      model.updateMatrixWorld(true);
      feet.forEach((f, k) => samples[k]!.push({ y: f.getWorldPosition(p).y, z: p.z }));
    }
    // A planted foot slides backward (-Z) at ground speed; take the speed while it is lowest.
    const speeds: number[] = [];
    const dt = clip.duration / steps;
    for (const s of samples) {
      const minY = Math.min(...s.map((v) => v.y));
      for (let i = 1; i < s.length; i++) if (s[i]!.y < minY + 0.03 && s[i - 1]!.y < minY + 0.03) speeds.push((s[i - 1]!.z - s[i]!.z) / dt);
    }
    speeds.sort((a, b) => a - b);
    const median = speeds[Math.floor(speeds.length / 2)];
    if (median && median > 0.3) clipSpeed.set(name, median);
    action.stop();
  }

  const sitPelvis = new THREE.Vector3(0, 0.5, 0);
  const sit = clips.get("Sitting_Idle_Loop");
  if (sit && pelvis) {
    mixer.stopAllAction();
    mixer.clipAction(sit).play();
    mixer.update(0);
    model.updateMatrixWorld(true);
    pelvis.getWorldPosition(sitPelvis);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(model);
  return { clipSpeed, sitPelvis };
}

export function cloneSkinned(scene: THREE.Object3D): THREE.Object3D {
  return cloneSkeleton(scene);
}

function findMesh(root: THREE.Object3D): THREE.Mesh | null {
  let found: THREE.Mesh | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh;
  });
  return found;
}

function prepareBody(scene: THREE.Object3D): void {
  scene.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    mesh.castShadow = mesh.name.startsWith("Body");
    mesh.receiveShadow = false;
    // Animated limbs leave the bind-pose bounds; skip per-mesh culling (the player is culled as a whole by distance).
    mesh.frustumCulled = false;
  });
}

function restPelvisHeight(scene: THREE.Object3D): number {
  const pelvis = scene.getObjectByName("pelvis");
  return pelvis ? pelvis.position.length() : 0;
}

/**
 * The animation mannequin's hips sit at a slightly different height than each body's; scale the
 * pelvis translation so feet meet the ground instead of floating or sinking.
 */
function fitClip(clip: THREE.AnimationClip, ratio: number): THREE.AnimationClip {
  if (Math.abs(ratio - 1) < 0.001) return clip;
  const fitted = clip.clone();
  for (const track of fitted.tracks) {
    if (track.name !== "pelvis.position") continue;
    const values = track.values.slice();
    for (let i = 0; i < values.length; i++) values[i] = values[i]! * ratio;
    track.values = values;
  }
  return fitted;
}
