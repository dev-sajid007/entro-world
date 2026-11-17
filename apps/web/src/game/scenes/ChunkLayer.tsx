import { memo, useEffect, useMemo, useSyncExternalStore } from "react";
import * as THREE from "three";
import { getCityLayout, type Building, type FacadeStyle, type Prop, type PropKind } from "@entroworld/world-assets";
import type { ChunkLevel, GameEngine } from "../core/GameEngine";
import { buildChunkBuildings, hash, propGeometry } from "../assets/geometry";
import { facadeMaterial, propMaterial, roofMaterial, signMaterial } from "../assets/materials";
import { signAtlas } from "../assets/textures";

interface ChunkContent {
  buildings: Building[];
  props: Map<PropKind, Prop[]>;
}

let index: Map<string, ChunkContent> | null = null;
function chunkIndex(): Map<string, ChunkContent> {
  if (index) return index;
  index = new Map();
  const layout = getCityLayout();
  for (const c of layout.chunks) index.set(c.key, { buildings: [], props: new Map() });
  for (const b of layout.buildings) index.get(b.chunk)?.buildings.push(b);
  for (const p of layout.props) {
    const content = index.get(p.chunk);
    if (!content) continue;
    const list = content.props.get(p.kind) ?? [];
    list.push(p);
    content.props.set(p.kind, list);
  }
  return index;
}

let atlas: ReturnType<typeof signAtlas> | null = null;
function getSignAtlas() {
  if (!atlas) {
    const names = [...new Set(getCityLayout().buildings.map((b) => b.sign).filter((s): s is string => !!s))].sort();
    atlas = signAtlas(names);
  }
  return atlas;
}

/** Props that are skipped entirely in low-detail chunks. */
const HIGH_ONLY: ReadonlySet<PropKind> = new Set(["bench", "trash", "flowerbed", "picnic", "lounger", "volleyNet", "bush", "planter", "umbrella"]);
/** Props tinted per instance from their `color`. */
const TINTED: ReadonlySet<PropKind> = new Set(["umbrella", "foodTruck"]);

function buildInstances(kind: PropKind, props: Prop[], lod: "high" | "low"): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(propGeometry(kind, lod), propMaterial(), props.length);
  const tmp = new THREE.Object3D();
  const color = new THREE.Color();
  props.forEach((p, i) => {
    tmp.position.set(p.x, p.y, p.z);
    tmp.rotation.set(0, p.rotation, 0);
    tmp.scale.setScalar(p.scale);
    tmp.updateMatrix();
    mesh.setMatrixAt(i, tmp.matrix);
    if (TINTED.has(kind) && p.color) color.set(p.color);
    else if (kind === "tree" || kind === "bush" || kind === "palm") color.setHSL(0, 0, 0.85 + (hash(p.id) % 30) / 100);
    else color.setRGB(1, 1, 1);
    mesh.setColorAt(i, color);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = lod === "high";
  mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

const ChunkView = memo(function ChunkView({ chunkKey, level }: { chunkKey: string; level: Exclude<ChunkLevel, "hidden"> }) {
  const content = chunkIndex().get(chunkKey);
  const built = useMemo(() => {
    if (!content) return null;
    const lod = level === "high" ? "high" : "low";
    const { uv, texture } = getSignAtlas();
    const meshes = buildChunkBuildings(content.buildings, uv, lod);
    const objects: THREE.Object3D[] = [];
    for (const [style, geometry] of meshes.facades) {
      const m = new THREE.Mesh(geometry, facadeMaterial(style as FacadeStyle));
      m.castShadow = true;
      m.receiveShadow = true;
      objects.push(m);
    }
    if (meshes.roofs) {
      const m = new THREE.Mesh(meshes.roofs, roofMaterial());
      m.castShadow = lod === "high";
      m.receiveShadow = true;
      objects.push(m);
    }
    if (meshes.signs) objects.push(new THREE.Mesh(meshes.signs, signMaterial(texture)));
    for (const [kind, props] of content.props) {
      if (lod === "low" && HIGH_ONLY.has(kind)) continue;
      objects.push(buildInstances(kind, props, lod));
    }
    return objects;
  }, [content, level]);

  useEffect(
    () => () => {
      // Merged building geometry is unique per chunk; prop geometry and materials are shared caches.
      for (const o of built ?? []) {
        if (o instanceof THREE.InstancedMesh) o.dispose();
        else if (o instanceof THREE.Mesh) o.geometry.dispose();
      }
    },
    [built],
  );

  if (!built) return null;
  return (
    <group>
      {built.map((o) => (
        <primitive key={o.uuid} object={o} />
      ))}
    </group>
  );
});

/** Streams city chunks in and out around the camera, with two levels of detail. */
export function ChunkLayer({ engine }: { engine: GameEngine }) {
  const { levels } = useSyncExternalStore(engine.chunks.subscribe, engine.chunks.get);
  return (
    <group>
      {Object.entries(levels).map(([key, level]) =>
        level === "hidden" ? null : <ChunkView key={key} chunkKey={key} level={level} />,
      )}
    </group>
  );
}
