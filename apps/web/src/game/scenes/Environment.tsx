import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Environment as DreiEnvironment, Sky } from "@react-three/drei";
import { getCityLayout, MARKET_ANNEX, SHORELINE_X, type Surface, type SurfaceKind } from "@entroworld/world-assets";
import type { GameEngine } from "../core/GameEngine";
import { plainMaterial, pondMaterial, surfaceMaterial, waterMaterial } from "../assets/materials";
import { SURFACE_TILE } from "../assets/textures";

/** Late-afternoon sun direction. */
export const SUN_DIRECTION = new THREE.Vector3(-0.55, 0.62, 0.35).normalize();

export function Atmosphere({ engine, shadows, shadowMapSize = 2048 }: { engine: GameEngine; shadows: boolean; shadowMapSize?: number }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  const sunPosition = useMemo(() => SUN_DIRECTION.clone().multiplyScalar(400).toArray() as [number, number, number], []);

  useFrame(() => {
    const l = light.current;
    if (!l) return;
    // The shadow camera follows the player; snapping to texels avoids shimmering edges.
    const texel = 140 / shadowMapSize;
    const fx = Math.round(engine.focus.x / texel) * texel;
    const fz = Math.round(engine.focus.z / texel) * texel;
    target.position.set(fx, 0, fz);
    l.position.set(fx + SUN_DIRECTION.x * 160, SUN_DIRECTION.y * 160, fz + SUN_DIRECTION.z * 160);
    target.updateMatrixWorld();
  });

  return (
    <>
      <color attach="background" args={["#b9cfe0"]} />
      <fog attach="fog" args={["#c6d5e0", 160, 720]} />
      <Sky distance={4500} sunPosition={sunPosition} turbidity={5.5} rayleigh={1.4} mieCoefficient={0.004} mieDirectionalG={0.82} />
      {/* Sky light is kept moderate so sunlit and shaded areas read clearly (strong IBL washes shadows out). */}
      <DreiEnvironment resolution={256} frames={1} environmentIntensity={0.4}>
        <Sky distance={4500} sunPosition={sunPosition} turbidity={5.5} rayleigh={1.4} mieCoefficient={0.004} mieDirectionalG={0.82} />
        <mesh position={[0, -40, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2000, 2000]} />
          <meshBasicMaterial color="#7d8a7a" />
        </mesh>
      </DreiEnvironment>
      <hemisphereLight args={["#dbe8f5", "#7a6f5d", 0.28]} />
      <primitive object={target} />
      <directionalLight
        ref={light}
        color="#fff1dc"
        intensity={3}
        target={target}
        castShadow={shadows}
        key={shadowMapSize}
        shadow-mapSize={[shadowMapSize, shadowMapSize]}
        shadow-camera-left={-70}
        shadow-camera-right={70}
        shadow-camera-top={70}
        shadow-camera-bottom={-70}
        shadow-camera-near={10}
        shadow-camera-far={400}
        shadow-bias={-0.0004}
        shadow-normalBias={0.05}
        shadow-radius={3}
        shadow-blurSamples={12}
      />
    </>
  );
}

/** Merges all surfaces of one kind into a single mesh with world-space UVs. */
function buildSurfaceGeometry(surfaces: Surface[], tile: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (const s of surfaces) {
    const { minX, maxX, minZ, maxZ } = s.rect;
    const base = positions.length / 3;
    positions.push(minX, s.y, maxZ, maxX, s.y, maxZ, maxX, s.y, minZ, minX, s.y, minZ);
    for (let i = 0; i < 4; i++) normals.push(0, 1, 0);
    uvs.push(minX / tile, -maxZ / tile, maxX / tile, -maxZ / tile, maxX / tile, -minZ / tile, minX / tile, -minZ / tile);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  g.setIndex(indices);
  g.computeBoundingSphere();
  return g;
}

/** Ground surfaces (streets, sidewalks, lots), grouped by kind and layer: one draw call each. */
export function Surfaces() {
  const groups = useMemo(() => {
    const byKey = new Map<string, { kind: SurfaceKind; layer: number; surfaces: Surface[] }>();
    for (const s of getCityLayout().surfaces) {
      const layer = Math.round(s.y * 100);
      const key = `${s.kind}:${layer}`;
      const entry = byKey.get(key) ?? { kind: s.kind, layer, surfaces: [] };
      entry.surfaces.push(s);
      byKey.set(key, entry);
    }
    return [...byKey.entries()].map(([key, g]) => {
      const material = surfaceMaterial(g.kind).clone();
      material.polygonOffset = true;
      material.polygonOffsetFactor = -g.layer;
      material.polygonOffsetUnits = -g.layer * 2;
      return { key, geometry: buildSurfaceGeometry(g.surfaces, SURFACE_TILE[g.kind]), material };
    });
  }, []);
  return (
    <group>
      {groups.map((g) => (
        <mesh key={g.key} geometry={g.geometry} material={g.material} receiveShadow />
      ))}
    </group>
  );
}

/** Lane markings and crosswalks as two instanced meshes. */
export function RoadMarkings() {
  const { markings, crosswalks } = useMemo(() => {
    const layout = getCityLayout();
    const material = new THREE.MeshStandardMaterial({ color: "#e9e4d4", roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -12 });
    const geom = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const m = new THREE.InstancedMesh(geom, material, layout.roadMarkings.length);
    const tmp = new THREE.Object3D();
    layout.roadMarkings.forEach((r, i) => {
      tmp.position.set(r.x, 0.015, r.z);
      tmp.rotation.set(0, r.rotation, 0);
      tmp.scale.set(r.width, 1, r.length);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
    });
    m.receiveShadow = true;
    // Each crosswalk has 7 stripes.
    const stripes = layout.crosswalks.length * 7;
    const c = new THREE.InstancedMesh(geom, material, stripes);
    let n = 0;
    for (const cw of layout.crosswalks) {
      for (let k = 0; k < 7; k++) {
        const offset = (k - 3) * 1.3;
        const dx = Math.cos(cw.rotation) * offset;
        const dz = -Math.sin(cw.rotation) * offset;
        tmp.position.set(cw.x + dx, 0.015, cw.z + dz);
        tmp.rotation.set(0, cw.rotation, 0);
        tmp.scale.set(0.6, 1, 2.6);
        tmp.updateMatrix();
        c.setMatrixAt(n++, tmp.matrix);
      }
    }
    c.receiveShadow = true;
    return { markings: m, crosswalks: c };
  }, []);
  return (
    <>
      <primitive object={markings} />
      <primitive object={crosswalks} />
    </>
  );
}

/** Island slab, seawalls, beach slope and the surrounding sea. */
export function Island() {
  const layout = getCityLayout();
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  // The island is L-shaped: AI Agent Street extends the northern half to the west.
  const annex = MARKET_ANNEX;
  const southMinX = annex.maxX;
  const pond = layout.water.find((w) => w.kind === "pond");
  const beachSlope = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const x0 = SHORELINE_X - 3;
    const x1 = SHORELINE_X + 40;
    const z0 = 0;
    const z1 = maxZ + 4;
    g.setAttribute("position", new THREE.Float32BufferAttribute([x0, 0.03, z1, x1, -1.8, z1, x1, -1.8, z0, x0, 0.03, z0], 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute([0.04, 1, 0, 0.04, 1, 0, 0.04, 1, 0, 0.04, 1, 0], 3));
    const t = 6;
    g.setAttribute("uv", new THREE.Float32BufferAttribute([x0 / t, -z1 / t, x1 / t, -z1 / t, x1 / t, -z0 / t, x0 / t, -z0 / t], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    return g;
  }, [maxZ]);
  const wall = plainMaterial("#a9a59c", 0.9);
  const railing = plainMaterial("#d7d3cb", 0.6, 0.2);
  const depth = 5;
  return (
    <group>
      {/* Island slab (north half reaches the east edge, south half stops at the beach). */}
      <mesh position={[(minX + maxX) / 2, -depth / 2 - 0.01, (minZ - 4) / 2]} material={wall} receiveShadow>
        <boxGeometry args={[maxX - minX + 8, depth, -minZ + 4]} />
      </mesh>
      <mesh position={[(southMinX - 4 + SHORELINE_X - 3) / 2, -depth / 2 - 0.01, (maxZ + 4) / 2]} material={wall} receiveShadow>
        <boxGeometry args={[SHORELINE_X - 3 - southMinX + 4, depth, maxZ + 4]} />
      </mesh>
      <mesh geometry={beachSlope} material={surfaceMaterial("sand")} receiveShadow />
      {/* Promenade railings along the seawall. */}
      <mesh position={[(minX + maxX) / 2, 0.5, minZ - 0.5]} material={railing} castShadow>
        <boxGeometry args={[maxX - minX + 2, 1, 0.2]} />
      </mesh>
      <mesh position={[(southMinX + SHORELINE_X) / 2 - 2, 0.5, maxZ + 0.5]} material={railing} castShadow>
        <boxGeometry args={[SHORELINE_X - southMinX - 2, 1, 0.2]} />
      </mesh>
      <mesh position={[minX - 0.5, 0.5, (minZ + annex.maxZ) / 2]} material={railing} castShadow>
        <boxGeometry args={[0.2, 1, annex.maxZ - minZ + 2]} />
      </mesh>
      <mesh position={[(minX + southMinX) / 2 - 0.5, 0.5, annex.maxZ + 0.5]} material={railing} castShadow>
        <boxGeometry args={[southMinX - minX + 1, 1, 0.2]} />
      </mesh>
      <mesh position={[southMinX - 0.5, 0.5, maxZ / 2]} material={railing} castShadow>
        <boxGeometry args={[0.2, 1, maxZ + 2]} />
      </mesh>
      <mesh position={[maxX + 0.5, 0.5, minZ / 2]} material={railing} castShadow>
        <boxGeometry args={[0.2, 1, -minZ + 2]} />
      </mesh>
      {/* Sea. */}
      <mesh position={[0, -0.55, 0]} rotation={[-Math.PI / 2, 0, 0]} material={waterMaterial()}>
        <planeGeometry args={[2600, 2600]} />
      </mesh>
      {pond && (
        <group position={[pond.x, 0, pond.z]}>
          <mesh position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[pond.width / 2, pond.depth / 2, 1]} material={pondMaterial()}>
            <circleGeometry args={[1, 48]} />
          </mesh>
          <mesh position={[0, 0.12, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[pond.width / 2, pond.depth / 2, 1]} material={plainMaterial("#8d887c", 0.95)} receiveShadow>
            <ringGeometry args={[0.97, 1.08, 48]} />
          </mesh>
        </group>
      )}
    </group>
  );
}
