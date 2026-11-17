import { memo, useEffect, useMemo } from "react";
import * as THREE from "three";
import type { FurniturePlacement, PropertyView } from "@entroworld/shared";
import { ITEMS_BY_ID, getCityLayout, type Plot } from "@entroworld/world-assets";
import { labelTexture } from "../assets/textures";
import { plainMaterial } from "../assets/materials";

const DEFAULT_WALL = "#e9e2d0";
const DEFAULT_ROOF = "#8b3a2b";
const FLOOR_COLORS = { wood: "#a47148", tile: "#d8d4cc", carpet: "#7c8db0" } as const;

function roofGeometry(width: number, depth: number, rise: number): THREE.BufferGeometry {
  const hw = width / 2 + 0.4;
  const hd = depth / 2 + 0.4;
  // Ridge runs along X; two sloped faces plus two gable triangles.
  const v = [
    // Front slope (faces -Z and up)
    hw, 0, -hd, -hw, 0, -hd, -hw, rise, 0, hw, rise, 0,
    // Back slope (faces +Z and up)
    -hw, 0, hd, hw, 0, hd, hw, rise, 0, -hw, rise, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  g.computeVertexNormals();
  const gable = new THREE.BufferGeometry();
  gable.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-hw + 0.4, 0, -hd + 0.4, -hw + 0.4, 0, hd - 0.4, -hw + 0.4, rise - 0.3, 0, hw - 0.4, 0, hd - 0.4, hw - 0.4, 0, -hd + 0.4, hw - 0.4, rise - 0.3, 0], 3),
  );
  gable.setIndex([0, 1, 2, 3, 4, 5]);
  gable.computeVertexNormals();
  g.userData.gable = gable;
  return g;
}

function Furniture({ item, color }: { item: FurniturePlacement; color?: string | undefined }) {
  const def = ITEMS_BY_ID.get(item.itemId);
  if (!def) return null;
  const c = color ?? def.color;
  const m = plainMaterial(c, 0.7);
  const dark = plainMaterial("#3a3530", 0.7);
  const { width: w, depth: d, height: h } = def;
  let body: React.ReactNode;
  switch (def.id) {
    case "chair":
      body = (
        <>
          <mesh position={[0, 0.45, 0]} material={m} castShadow><boxGeometry args={[w, 0.06, d]} /></mesh>
          <mesh position={[0, 0.7, d / 2 - 0.03]} material={m} castShadow><boxGeometry args={[w, 0.5, 0.05]} /></mesh>
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => (
            <mesh key={`${x}${z}`} position={[(x! * w) / 2.4, 0.22, (z! * d) / 2.4]} material={m}><boxGeometry args={[0.05, 0.44, 0.05]} /></mesh>
          ))}
        </>
      );
      break;
    case "table":
      body = (
        <>
          <mesh position={[0, h, 0]} material={m} castShadow><boxGeometry args={[w, 0.06, d]} /></mesh>
          {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => (
            <mesh key={`${x}${z}`} position={[(x! * w) / 2.3, h / 2, (z! * d) / 2.3]} material={m}><boxGeometry args={[0.07, h, 0.07]} /></mesh>
          ))}
        </>
      );
      break;
    case "sofa":
    case "armchair":
      body = (
        <>
          <mesh position={[0, 0.25, 0]} material={m} castShadow><boxGeometry args={[w, 0.4, d]} /></mesh>
          <mesh position={[0, 0.6, d / 2 - 0.12]} material={m} castShadow><boxGeometry args={[w, 0.5, 0.24]} /></mesh>
          <mesh position={[-w / 2 + 0.1, 0.5, 0]} material={m}><boxGeometry args={[0.2, 0.3, d]} /></mesh>
          <mesh position={[w / 2 - 0.1, 0.5, 0]} material={m}><boxGeometry args={[0.2, 0.3, d]} /></mesh>
        </>
      );
      break;
    case "bed":
      body = (
        <>
          <mesh position={[0, 0.2, 0]} material={plainMaterial("#6d4c41")} castShadow><boxGeometry args={[w, 0.3, d]} /></mesh>
          <mesh position={[0, 0.45, 0.1]} material={m}><boxGeometry args={[w - 0.1, 0.2, d - 0.3]} /></mesh>
          <mesh position={[0, 0.6, d / 2 - 0.3]} material={plainMaterial("#ffffff")}><boxGeometry args={[w - 0.4, 0.12, 0.35]} /></mesh>
          <mesh position={[0, 0.55, -d / 2 + 0.05]} material={plainMaterial("#6d4c41")}><boxGeometry args={[w, 0.9, 0.08]} /></mesh>
        </>
      );
      break;
    case "bookshelf":
      body = (
        <>
          <mesh position={[0, h / 2, 0]} material={m} castShadow><boxGeometry args={[w, h, d]} /></mesh>
          {[0.35, 0.8, 1.25, 1.65].map((y, i) => (
            <mesh key={y} position={[0, y, -d / 2 - 0.005]} material={plainMaterial(["#b91c1c", "#1d4ed8", "#047857", "#ca8a04"][i]!)}>
              <boxGeometry args={[w - 0.1, 0.28, 0.02]} />
            </mesh>
          ))}
        </>
      );
      break;
    case "tv":
      body = (
        <>
          <mesh position={[0, 0.25, 0]} material={plainMaterial("#5d4037")} castShadow><boxGeometry args={[w, 0.5, d]} /></mesh>
          <mesh position={[0, 0.85, 0]} material={dark} castShadow><boxGeometry args={[w * 0.9, 0.62, 0.05]} /></mesh>
          <mesh position={[0, 0.85, -0.03]} rotation={[0, Math.PI, 0]}><planeGeometry args={[w * 0.85, 0.55]} /><meshStandardMaterial color="#1e3a8a" emissive="#1e40af" emissiveIntensity={0.4} /></mesh>
        </>
      );
      break;
    case "rug":
      body = <mesh position={[0, 0.015, 0]} material={m} receiveShadow><boxGeometry args={[w, 0.02, d]} /></mesh>;
      break;
    case "plant":
      body = (
        <>
          <mesh position={[0, 0.2, 0]} material={plainMaterial("#b45309")} castShadow><cylinderGeometry args={[0.2, 0.15, 0.4, 12]} /></mesh>
          <mesh position={[0, 0.75, 0]} material={m} castShadow><icosahedronGeometry args={[0.35, 1]} /></mesh>
        </>
      );
      break;
    case "painting":
      body = (
        <>
          <mesh position={[0, 1.6, 0]} material={plainMaterial("#3f2d20")}><boxGeometry args={[w, h, 0.05]} /></mesh>
          <mesh position={[0, 1.6, -0.03]} rotation={[0, Math.PI, 0]}><planeGeometry args={[w - 0.12, h - 0.12]} /><meshStandardMaterial color={c} /></mesh>
        </>
      );
      break;
    case "floor_lamp":
      body = (
        <>
          <mesh position={[0, 0.85, 0]} material={dark}><cylinderGeometry args={[0.025, 0.025, 1.7, 8]} /></mesh>
          <mesh position={[0, 1.6, 0]}><coneGeometry args={[0.22, 0.3, 16, 1, true]} /><meshStandardMaterial color={c} emissive="#fff4d6" emissiveIntensity={0.7} side={THREE.DoubleSide} /></mesh>
          <mesh position={[0, 0.02, 0]} material={dark}><cylinderGeometry args={[0.18, 0.2, 0.04, 16]} /></mesh>
        </>
      );
      break;
    case "garden_bench":
      body = (
        <>
          <mesh position={[0, 0.45, 0]} material={m} castShadow><boxGeometry args={[w, 0.06, d]} /></mesh>
          <mesh position={[0, 0.75, d / 2 - 0.03]} material={m}><boxGeometry args={[w, 0.4, 0.05]} /></mesh>
          {[-1, 1].map((x) => (
            <mesh key={x} position={[(x * w) / 2.3, 0.22, 0]} material={dark}><boxGeometry args={[0.06, 0.44, d]} /></mesh>
          ))}
        </>
      );
      break;
    case "bbq":
      body = (
        <>
          <mesh position={[0, 0.8, 0]} material={m} castShadow><sphereGeometry args={[0.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
          <mesh position={[0, 0.8, 0]} material={m} rotation={[Math.PI, 0, 0]}><sphereGeometry args={[0.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /></mesh>
          <mesh position={[0, 0.3, 0]} material={dark}><cylinderGeometry args={[0.03, 0.03, 0.6, 6]} /></mesh>
        </>
      );
      break;
    case "parasol":
      body = (
        <>
          <mesh position={[0, 1.2, 0]} material={plainMaterial("#e5e5e5")}><cylinderGeometry args={[0.03, 0.03, 2.4, 6]} /></mesh>
          <mesh position={[0, 2.35, 0]} material={m} castShadow><coneGeometry args={[1.1, 0.45, 12, 1, true]} /></mesh>
        </>
      );
      break;
    default:
      body = <mesh position={[0, h / 2, 0]} material={m}><boxGeometry args={[w, h, d]} /></mesh>;
  }
  return (
    <group position={[item.x, 0.06, item.z]} rotation={[0, item.rotation, 0]}>
      {body}
    </group>
  );
}

const House = memo(function House({ plot, property }: { plot: Plot; property: PropertyView | null }) {
  const config = property?.configuration;
  const wall = plainMaterial(config?.wallColor ?? DEFAULT_WALL, 0.85);
  const roof = plainMaterial(config?.roofColor ?? DEFAULT_ROOF, 0.8);
  const { width, depth, centerZ, wallHeight, doorWidth } = plot.house;
  const roofGeo = useMemo(() => roofGeometry(width, depth, 2.4), [width, depth]);
  useEffect(() => () => {
    roofGeo.dispose();
    (roofGeo.userData.gable as THREE.BufferGeometry).dispose();
  }, [roofGeo]);
  const sign = useMemo(
    () =>
      labelTexture([`Lot ${plot.number}`, property ? property.name : "Available — press E"], {
        font: "600 30px system-ui, sans-serif",
        color: property ? "#f8fafc" : "#14532d",
        background: property ? "#1e3a5f" : "#dcfce7",
        padding: 16,
        radius: 8,
      }),
    [plot.number, property],
  );
  useEffect(() => () => sign.texture.dispose(), [sign]);
  const sideLen = (width - doorWidth) / 2;
  const t = 0.2;
  const floor = plainMaterial(FLOOR_COLORS[config?.floorStyle ?? "wood"], 0.8);
  return (
    <group position={[plot.x, 0, plot.z]} rotation={[0, plot.rotation, 0]}>
      <group position={[0, 0, centerZ]}>
        <mesh position={[0, 0.03, 0]} material={floor} receiveShadow>
          <boxGeometry args={[width, 0.06, depth]} />
        </mesh>
        <mesh position={[0, wallHeight / 2, depth / 2]} material={wall} castShadow receiveShadow>
          <boxGeometry args={[width, wallHeight, t]} />
        </mesh>
        <mesh position={[-width / 2, wallHeight / 2, 0]} material={wall} castShadow receiveShadow>
          <boxGeometry args={[t, wallHeight, depth]} />
        </mesh>
        <mesh position={[width / 2, wallHeight / 2, 0]} material={wall} castShadow receiveShadow>
          <boxGeometry args={[t, wallHeight, depth]} />
        </mesh>
        <mesh position={[-(doorWidth / 2 + sideLen / 2), wallHeight / 2, -depth / 2]} material={wall} castShadow receiveShadow>
          <boxGeometry args={[sideLen, wallHeight, t]} />
        </mesh>
        <mesh position={[doorWidth / 2 + sideLen / 2, wallHeight / 2, -depth / 2]} material={wall} castShadow receiveShadow>
          <boxGeometry args={[sideLen, wallHeight, t]} />
        </mesh>
        <mesh position={[0, wallHeight - 0.45, -depth / 2]} material={wall} castShadow>
          <boxGeometry args={[doorWidth, 0.9, t]} />
        </mesh>
        {/* Windows */}
        {[-1, 1].map((side) => (
          <mesh key={side} position={[side * (width / 2 + 0.11), 1.7, 0]} rotation={[0, side * Math.PI / 2, 0]}>
            <planeGeometry args={[2.2, 1.2]} />
            <meshStandardMaterial color="#4b6a82" roughness={0.1} metalness={0.4} />
          </mesh>
        ))}
        <group position={[0, wallHeight, 0]}>
          <mesh geometry={roofGeo} material={roof} castShadow receiveShadow />
          <mesh geometry={roofGeo.userData.gable as THREE.BufferGeometry} material={wall} />
        </group>
        {(config?.furniture ?? []).map((f) => (
          <group key={f.id} position={[0, 0, -centerZ]}>
            <Furniture item={f} color={f.color} />
          </group>
        ))}
      </group>
      {/* Front path and sign */}
      <mesh position={[0, 0.035, (-plot.depth / 2 + centerZ - depth / 2) / 2]} rotation={[-Math.PI / 2, 0, 0]} material={plainMaterial("#b9ae9b", 0.9)} receiveShadow>
        <planeGeometry args={[1.6, Math.abs(-plot.depth / 2 - (centerZ - depth / 2))]} />
      </mesh>
      <group position={[-plot.width / 2 + 2, 0, -plot.depth / 2 + 1.5]}>
        <mesh position={[0, 0.7, 0]} material={plainMaterial("#5b4632")} castShadow>
          <boxGeometry args={[0.1, 1.4, 0.1]} />
        </mesh>
        <mesh position={[0, 1.3, -0.06]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[1.5, 1.5 / sign.aspect]} />
          <meshStandardMaterial map={sign.texture} />
        </mesh>
      </group>
    </group>
  );
});

/** Residential plots with their houses, customized from property data when owned. */
export function Plots({ properties }: { properties: ReadonlyMap<string, PropertyView> }) {
  const plots = getCityLayout().plots;
  return (
    <group>
      {plots.map((p) => (
        <House key={p.id} plot={p} property={properties.get(p.id) ?? null} />
      ))}
    </group>
  );
}
