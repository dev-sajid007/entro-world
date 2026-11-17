#!/usr/bin/env node
/**
 * Converts the Quaternius "Universal Base Characters" and "Universal Animation Library" packs
 * (CC0, https://quaternius.com) into the small files the web client loads from /avatars/.
 *
 * Usage: put the two [Standard] zips in assets-src/avatars/, extract them into chars/ and anims/,
 * then run `node infra/scripts/build-avatars.mjs`. Output goes to apps/web/public/avatars/.
 *
 * - body-<shape>.glb: skinned body, eyes and eyebrows; base color = the light skin texture (the
 *   client tints it to the chosen skin tone and paints clothing in a shader), normal map, no extra
 *   UV/color sets. Textures are WebP, geometry is meshopt-compressed.
 * - hair-<style>.glb: static hair meshes in the Head bone's local space, so the client can parent
 *   them to the Head bone of either body. Hair textures are grayscale (tinted at runtime).
 * - animations.glb: the clips the game uses, on the shared 65-bone skeleton, without the mannequin.
 * - manifest.json: clip ground speeds (for foot sync), head sizes, a content version for caching.
 */
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { dedup, meshopt, prune, resample, textureCompress } from "@gltf-transform/functions";
import { MeshoptEncoder } from "meshoptimizer";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SRC = path.join(ROOT, "assets-src/avatars");
const CHARS = path.join(SRC, "chars/Universal Base Characters[Standard]");
const ANIMS = path.join(SRC, "anims/Universal Animation Library[Standard]/Unreal-Godot");
const OUT = path.join(ROOT, "apps/web/public/avatars");
mkdirSync(OUT, { recursive: true });

await MeshoptEncoder.ready;

/**
 * Some .gltf files in the pack reference texture names that don't exist next to them
 * (e.g. "T_Hair_1_Normal_png.png"). Copy the matching texture in under the expected name.
 */
function repairTextureRefs(dir) {
  const searchDirs = [dir, path.join(CHARS, "Base Characters/Textures/Normals Unity - Godot"), path.join(CHARS, "Base Characters/Textures"), path.join(CHARS, "Hairstyles/Textures/Normals Unity - Godot"), path.join(CHARS, "Hairstyles/Textures")];
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".gltf"))) {
    for (const img of JSON.parse(readFileSync(path.join(dir, f), "utf8")).images ?? []) {
      if (!img.uri || existsSync(path.join(dir, img.uri))) continue;
      const wanted = img.uri.replace(/_png\.png$/, ".png");
      const normal = /Normal/i.test(wanted);
      const ordered = normal ? searchDirs : [dir, searchDirs[2], searchDirs[4]];
      const found = ordered.map((d) => path.join(d, wanted)).find((p) => existsSync(p));
      if (!found) throw new Error(`${f}: can't find texture ${img.uri}`);
      copyFileSync(found, path.join(dir, img.uri));
    }
  }
}
repairTextureRefs(path.join(CHARS, "Base Characters/Godot - UE"));
repairTextureRefs(path.join(CHARS, "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)"));
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ "meshopt.encoder": MeshoptEncoder });

const BODIES = {
  masculine: { file: "Superhero_Male_FullBody.gltf", baseColor: "Textures/T_Superhero_Male_Ligh.png" },
  feminine: { file: "Superhero_Female_FullBody.gltf", baseColor: "Textures/T_Superhero_Female_Light_BaseColor.png" },
};

/** Hairstyles: source file and the body it was modelled on. */
const HAIR = {
  buzz: { file: "Hair_Buzzed.gltf", fits: "masculine" },
  "buzz-f": { file: "Hair_BuzzedFemale.gltf", fits: "feminine" },
  short: { file: "Hair_SimpleParted.gltf", fits: "masculine" },
  long: { file: "Hair_Long.gltf", fits: "feminine" },
  buns: { file: "Hair_Buns.gltf", fits: "feminine" },
  beard: { file: "Hair_Beard.gltf", fits: "masculine" },
};

/** Clips the game plays (UAL names). */
const CLIPS = [
  "Idle_Loop",
  "Walk_Loop",
  "Jog_Fwd_Loop",
  "Jump_Start",
  "Jump_Loop",
  "Jump_Land",
  "Sitting_Idle_Loop",
  "Sitting_Talking_Loop",
  "Dance_Loop",
  "Idle_Talking_Loop",
  "Interact",
];

const KEEP_ATTRIBUTES = new Set(["POSITION", "NORMAL", "TANGENT", "TEXCOORD_0", "JOINTS_0", "WEIGHTS_0"]);

/** Grayscale with the average brightness lifted to ~0.75, so `color` alone sets the hair color. */
async function grayscaleTint(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    n++;
  }
  const k = (0.75 * 255) / Math.max(1, sum / Math.max(1, n));
  for (let i = 0; i < data.length; i += 4) {
    const l = Math.min(255, (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) * k);
    data[i] = data[i + 1] = data[i + 2] = l;
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

async function compressTextures(doc) {
  await doc.transform(
    textureCompress({ encoder: sharp, targetFormat: "webp", pattern: /Superhero/i, resize: [1024, 1024], quality: 88 }),
    textureCompress({ encoder: sharp, targetFormat: "webp", pattern: /Hair/i, resize: [512, 512], quality: 88 }),
    textureCompress({ encoder: sharp, targetFormat: "webp", pattern: /Eye/i, resize: [128, 128], quality: 88 }),
  );
}

async function tintHairTextures(doc) {
  for (const tex of doc.getRoot().listTextures()) {
    const name = `${tex.getName()} ${tex.getURI()}`;
    if (/Hair/i.test(name) && /BaseColor/i.test(name)) tex.setImage(await grayscaleTint(Buffer.from(tex.getImage())));
  }
}

function stripAttributes(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      for (const semantic of prim.listSemantics()) if (!KEEP_ATTRIBUTES.has(semantic)) prim.setAttribute(semantic, null);
    }
  }
}

const manifest = { version: "", bodies: {}, hair: {}, clips: {} };
const written = [];
async function write(doc, name) {
  const file = path.join(OUT, name);
  await io.write(file, doc);
  written.push(file);
  console.log(`${name}: ${(readFileSync(file).length / 1024).toFixed(0)} KB`);
}

// ---------------------------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------------------------
for (const [shape, spec] of Object.entries(BODIES)) {
  const dir = path.join(CHARS, "Base Characters/Godot - UE");
  const doc = await io.read(path.join(dir, spec.file));
  const root = doc.getRoot();
  for (const mat of root.listMaterials()) {
    const name = mat.getName();
    const kind = /Eyes/.test(name) ? "Eyes" : /Hair/.test(name) ? "Brows" : "Body";
    mat.setName(kind);
    mat.setMetallicRoughnessTexture(null);
    if (kind === "Body") {
      mat.getBaseColorTexture()?.setImage(readFileSync(path.join(CHARS, "Base Characters", spec.baseColor)));
      mat.setRoughnessFactor(0.6);
    }
  }
  for (const node of root.listNodes()) {
    const prim = node.getMesh()?.listPrimitives()[0];
    if (prim) node.setName(prim.getMaterial()?.getName() ?? node.getName());
  }
  // Head size from the eyebrow mesh width (used to fit hair from the other body).
  const brows = root.listMeshes().find((m) => m.listPrimitives()[0].getMaterial()?.getName() === "Brows");
  const pos = brows?.listPrimitives()[0].getAttribute("POSITION");
  manifest.bodies[shape] = { file: `body-${shape}.glb`, browWidth: pos ? +(pos.getMax([])[0] - pos.getMin([])[0]).toFixed(4) : null };
  stripAttributes(doc);
  await tintHairTextures(doc);
  await doc.transform(prune(), dedup());
  await compressTextures(doc);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  await write(doc, `body-${shape}.glb`);
}

// ---------------------------------------------------------------------------------------------
// Hair: un-skin into Head-bone space
// ---------------------------------------------------------------------------------------------
for (const [style, spec] of Object.entries(HAIR)) {
  const doc = await io.read(path.join(CHARS, "Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)", spec.file));
  const root = doc.getRoot();
  const scene = root.listScenes()[0];
  const meshNode = root.listNodes().find((n) => n.getMesh() && n.getSkin());
  if (!meshNode) throw new Error(`${spec.file}: no skinned mesh`);
  const skin = meshNode.getSkin();
  const joints = skin.listJoints();
  const headIndex = joints.findIndex((j) => j.getName() === "Head");
  if (headIndex < 0) throw new Error(`${spec.file}: no Head joint`);
  const ibm = skin.getInverseBindMatrices().getElement(headIndex, []);
  const apply = (m, v, w) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2] + m[12 + r] * w);

  for (const prim of meshNode.getMesh().listPrimitives()) {
    const p = prim.getAttribute("POSITION");
    const n = prim.getAttribute("NORMAL");
    for (let i = 0; i < p.getCount(); i++) p.setElement(i, apply(ibm, p.getElement(i, []), 1));
    if (n) {
      for (let i = 0; i < n.getCount(); i++) {
        const v = apply(ibm, n.getElement(i, []), 0);
        const len = Math.hypot(...v) || 1;
        n.setElement(i, v.map((c) => c / len));
      }
    }
    prim.setAttribute("JOINTS_0", null).setAttribute("WEIGHTS_0", null);
  }
  meshNode.setSkin(null).setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]).setName(`hair-${style}`);
  for (const child of scene.listChildren()) scene.removeChild(child);
  meshNode.getParentNode()?.removeChild(meshNode);
  scene.addChild(meshNode);
  for (const s of root.listSkins()) s.dispose();
  for (const node of root.listNodes()) if (node !== meshNode) node.dispose();
  for (const mat of root.listMaterials()) {
    mat.setName("Hair").setMetallicRoughnessTexture(null);
  }
  stripAttributes(doc);
  await tintHairTextures(doc);
  await doc.transform(prune(), dedup());
  await compressTextures(doc);
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: "medium" }));
  manifest.hair[style] = { file: `hair-${style}.glb`, fits: spec.fits };
  await write(doc, `hair-${style}.glb`);
}

// ---------------------------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------------------------
{
  // Ground speed of each clip from the root-motion export (distance the root travels per second).
  const rm = await io.read(path.join(ANIMS, "UAL1_Standard_RM.glb"));
  for (const anim of rm.getRoot().listAnimations()) {
    if (!CLIPS.includes(anim.getName())) continue;
    let speed = 0;
    let duration = 0;
    for (const ch of anim.listChannels()) {
      const input = ch.getSampler().getInput();
      duration = Math.max(duration, input.getMax([])[0]);
      if (ch.getTargetNode()?.getName() !== "root" || ch.getTargetPath() !== "translation") continue;
      const out = ch.getSampler().getOutput();
      const a = out.getElement(0, []);
      const b = out.getElement(out.getCount() - 1, []);
      const dt = input.getMax([])[0] - input.getMin([])[0];
      speed = dt > 0 ? Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / dt : 0;
    }
    manifest.clips[anim.getName()] = { speed: +speed.toFixed(3), duration: +duration.toFixed(3) };
  }

  const doc = await io.read(path.join(ANIMS, "UAL1_Standard.glb"));
  const root = doc.getRoot();
  // Samplers keep their keyframe accessors alive, so dispose them explicitly with the animation.
  const disposeAnimation = (anim) => {
    for (const s of anim.listSamplers()) s.dispose();
    for (const c of anim.listChannels()) c.dispose();
    anim.dispose();
  };
  for (const anim of root.listAnimations()) if (!CLIPS.includes(anim.getName())) disposeAnimation(anim);
  for (const anim of root.listAnimations()) {
    // In-place clips: drop root motion entirely; the game moves the character.
    for (const ch of anim.listChannels()) {
      const target = ch.getTargetNode()?.getName();
      // Bones keep their bind length; only the pelvis needs translation (bobbing, sitting down).
      if (target === "root" || ch.getTargetPath() === "scale" || (ch.getTargetPath() === "translation" && target !== "pelvis")) {
        ch.getSampler().dispose();
        ch.dispose();
        continue;
      }
      // Fingers: keep each clip's hand pose (first key) but not the motion; saves ~half the file.
      if (/^(index|middle|ring|pinky|thumb)_/.test(target ?? "")) {
        const sampler = ch.getSampler();
        const input = sampler.getInput();
        const output = sampler.getOutput();
        const first = output.getElement(0, []);
        sampler
          .setInput(doc.createAccessor().setType("SCALAR").setArray(new Float32Array([input.getMin([])[0]])))
          .setOutput(doc.createAccessor().setType(output.getType()).setArray(new Float32Array(first)))
          .setInterpolation("STEP");
      }
    }
  }
  for (const node of root.listNodes()) {
    if (node.getMesh()) node.setMesh(null).setSkin(null);
  }
  for (const s of root.listSkins()) s.dispose();
  for (const m of root.listMeshes()) m.dispose();
  for (const name of CLIPS) if (!root.listAnimations().some((a) => a.getName() === name)) throw new Error(`Missing clip ${name}`);
  await doc.transform(resample({ tolerance: 0.0005 }), prune({ keepLeaves: true }), dedup(), meshopt({ encoder: MeshoptEncoder, level: "high" }));
  await write(doc, "animations.glb");
}

const hash = createHash("sha256");
for (const f of written) hash.update(readFileSync(f));
manifest.version = hash.digest("hex").slice(0, 10);
writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("manifest:", JSON.stringify(manifest));
