import * as THREE from "three";
import type { FacadeStyle, SurfaceKind } from "@entroworld/world-assets";
import { FACADE_SPECS, SURFACE_TILE, facadeTextures, normalMapFrom, roofTexture, surfaceTexture, waterNormalTexture } from "./textures";

/** Surface relief per material (0 = flat). */
const SURFACE_RELIEF: Partial<Record<SurfaceKind, number>> = { asphalt: 1.4, sidewalk: 2.2, plaza: 2.2, concrete: 1.6, path: 1.6, grass: 1.2, sand: 0.8, wetsand: 0.5 };
const FACADE_RELIEF: Record<FacadeStyle, number> = { glass: 0.6, office: 1.2, brick: 3, stucco: 1.4, shop: 1.4, hall: 0.8, house: 1.8 };

/** Shared materials. Created lazily once per page and reused by every chunk. */
const materials = new Map<string, THREE.Material>();

function memo<T extends THREE.Material>(key: string, create: () => T): T {
  const hit = materials.get(key);
  if (hit) return hit as T;
  const m = create();
  materials.set(key, m);
  return m;
}

export function facadeMaterial(style: FacadeStyle): THREE.MeshStandardMaterial {
  return memo(`facade:${style}`, () => {
    const [map, roughnessMap] = facadeTextures(style);
    const spec = FACADE_SPECS[style];
    return new THREE.MeshStandardMaterial({
      map,
      roughnessMap,
      normalMap: normalMapFrom(map, FACADE_RELIEF[style]),
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: spec.roughness + 0.25,
      metalness: spec.metalness,
      vertexColors: true,
      envMapIntensity: style === "glass" || style === "hall" ? 1.25 : 0.6,
    });
  });
}

export function roofMaterial(): THREE.MeshStandardMaterial {
  return memo("roof", () => {
    const map = roofTexture();
    return new THREE.MeshStandardMaterial({ map, normalMap: normalMapFrom(map, 1.5), roughness: 0.95, metalness: 0, vertexColors: true });
  });
}

export function signMaterial(texture: THREE.Texture): THREE.MeshStandardMaterial {
  return memo(`sign:${texture.uuid}`, () =>
    new THREE.MeshStandardMaterial({ map: texture, emissiveMap: texture, emissive: new THREE.Color("#ffffff"), emissiveIntensity: 0.35, roughness: 0.6 }),
  );
}

export function surfaceMaterial(kind: SurfaceKind): THREE.MeshStandardMaterial {
  return memo(`surface:${kind}`, () => {
    const map = surfaceTexture(kind);
    const roughness = kind === "asphalt" ? 0.92 : kind === "wetsand" ? 0.55 : 0.95;
    const relief = SURFACE_RELIEF[kind] ?? 0;
    const m = new THREE.MeshStandardMaterial({
      map,
      roughness,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      ...(relief > 0 ? { normalMap: normalMapFrom(map, relief), normalScale: new THREE.Vector2(0.9, 0.9) } : {}),
    });
    m.userData.tile = SURFACE_TILE[kind];
    return m;
  });
}

export function propMaterial(): THREE.MeshStandardMaterial {
  return memo("props", () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05 }));
}

export function waterMaterial(): THREE.MeshStandardMaterial {
  return memo("water", () => {
    const normalMap = waterNormalTexture();
    normalMap.repeat.set(60, 60);
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color("#1f5f7a"),
      roughness: 0.08,
      metalness: 0.35,
      normalMap,
      normalScale: new THREE.Vector2(0.35, 0.35),
      envMapIntensity: 1.2,
      transparent: true,
      opacity: 0.94,
    });
  });
}

export function pondMaterial(): THREE.MeshStandardMaterial {
  return memo("pond", () => {
    const normalMap = waterNormalTexture().clone();
    normalMap.needsUpdate = true;
    normalMap.repeat.set(4, 4);
    return new THREE.MeshStandardMaterial({ color: new THREE.Color("#2d6f78"), roughness: 0.05, metalness: 0.3, normalMap, normalScale: new THREE.Vector2(0.25, 0.25) });
  });
}

export function plainMaterial(color: string, roughness = 0.85, metalness = 0): THREE.MeshStandardMaterial {
  return memo(`plain:${color}:${roughness}:${metalness}`, () => new THREE.MeshStandardMaterial({ color, roughness, metalness }));
}

/** Advances animated material parameters (water normal scrolling). */
export function animateMaterials(elapsed: number): void {
  const water = materials.get("water") as THREE.MeshStandardMaterial | undefined;
  if (water?.normalMap) water.normalMap.offset.set(elapsed * 0.004, elapsed * 0.0025);
  const pond = materials.get("pond") as THREE.MeshStandardMaterial | undefined;
  if (pond?.normalMap) pond.normalMap.offset.set(elapsed * 0.01, -elapsed * 0.006);
}
