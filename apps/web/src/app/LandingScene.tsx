import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { MODELS, MODEL_ORDER, buildModel } from "../game/scenes/carModels";

/**
 * The landing page's hero: a small floating diorama of the city (buildings with lit windows,
 * trees, a fountain plaza, cars on a ring road and people strolling). Self-contained and cheap: it
 * doesn't load the real city, avatars or physics.
 */
export default function LandingScene() {
  return (
    <Canvas
      dpr={[1, 1.75]}
      shadows
      camera={{ position: [46, 36, 46], fov: 32, near: 1, far: 400 }}
      gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping }}
      style={{ position: "absolute", inset: 0 }}
    >
      <hemisphereLight args={["#c7d2fe", "#0f172a", 0.9]} />
      <directionalLight position={[18, 30, 10]} intensity={2.2} color="#fff7ed" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-22} shadow-camera-right={22} shadow-camera-top={22} shadow-camera-bottom={-22} />
      <pointLight position={[0, 4, 0]} intensity={18} distance={16} color="#38bdf8" />
      <Diorama />
    </Canvas>
  );
}

const ISLAND = 18;
/** Ring road: cars drive around the plaza on this square (centre line), radius ROAD. */
const ROAD = 10.5;

/** A facade texture with a grid of windows, some of them lit. */
function windowTexture(seed: number): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, 64, 128);
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let y = 6; y < 124; y += 12) {
    for (let x = 6; x < 60; x += 14) {
      g.fillStyle = rand() < 0.35 ? "#fde68a" : "#1e293b";
      g.fillRect(x, y, 9, 7);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function Building({ x, z, w, d, h, color, seed }: { x: number; z: number; w: number; d: number; h: number; color: string; seed: number }) {
  const material = useMemo(() => {
    const map = windowTexture(seed);
    map.repeat.set(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 4)));
    const emissiveMap = map;
    return new THREE.MeshStandardMaterial({ color, map, emissiveMap, emissive: "#fbbf24", emissiveIntensity: 0.25, roughness: 0.6 });
  }, [color, seed, w, h]);
  const roof = useMemo(() => new THREE.MeshStandardMaterial({ color: "#334155", roughness: 0.8 }), []);
  useEffect(() => () => material.dispose(), [material]);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow material={[material, material, roof, roof, material, material]}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      <mesh position={[0, h + 0.15, 0]} castShadow material={roof}>
        <boxGeometry args={[w * 0.5, 0.3, d * 0.5]} />
      </mesh>
    </group>
  );
}

function Tree({ x, z, s = 1 }: { x: number; z: number; s?: number }) {
  return (
    <group position={[x, 0, z]} scale={s}>
      <mesh position={[0, 0.6, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.16, 1.2, 6]} />
        <meshStandardMaterial color="#78350f" />
      </mesh>
      <mesh position={[0, 1.6, 0]} castShadow>
        <icosahedronGeometry args={[0.8, 0]} />
        <meshStandardMaterial color="#22c55e" flatShading />
      </mesh>
      <mesh position={[0.35, 2.05, 0.1]} castShadow>
        <icosahedronGeometry args={[0.5, 0]} />
        <meshStandardMaterial color="#4ade80" flatShading />
      </mesh>
    </group>
  );
}

/** Position and heading on the ring road at distance `s` (counter-clockwise, outer lane). */
function onRing(s: number, lane: number): { x: number; z: number; heading: number } {
  const r = ROAD + lane;
  const side = 2 * r;
  const L = side * 4;
  const d = ((s % L) + L) % L;
  const k = Math.floor(d / side);
  const t = d - k * side - r;
  switch (k) {
    case 0:
      return { x: t, z: r, heading: Math.PI / 2 };
    case 1:
      return { x: r, z: -t, heading: Math.PI };
    case 2:
      return { x: -t, z: -r, heading: -Math.PI / 2 };
    default:
      return { x: -r, z: t, heading: 0 };
  }
}

const CAR_PAINT = ["#ef4444", "#2563eb", "#e5e7eb", "#f59e0b"];

function Cars() {
  const models = useMemo(() => MODEL_ORDER.map((m) => buildModel(MODELS[m])), []);
  const mats = useMemo(
    () => ({
      paint: CAR_PAINT.map((c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.3, metalness: 0.5, clearcoat: 1 })),
      glass: new THREE.MeshPhysicalMaterial({ color: "#0b1220", roughness: 0.05, metalness: 0.3, clearcoat: 1 }),
      trim: new THREE.MeshStandardMaterial({ color: "#16181d", roughness: 0.6 }),
      chrome: new THREE.MeshStandardMaterial({ color: "#e5e7eb", metalness: 1, roughness: 0.15 }),
      tire: new THREE.MeshStandardMaterial({ color: "#111", roughness: 0.9 }),
      rim: new THREE.MeshStandardMaterial({ color: "#cbd5e1", metalness: 0.9, roughness: 0.25 }),
      head: new THREE.MeshStandardMaterial({ color: "#fffbeb", emissive: "#fff4cc", emissiveIntensity: 2, toneMapped: false }),
      tail: new THREE.MeshStandardMaterial({ color: "#7f1d1d", emissive: "#ef4444", emissiveIntensity: 1.5, toneMapped: false }),
    }),
    [],
  );
  const cars = useMemo(() => [0, 1, 2, 3].map((i) => ({ model: models[i % models.length]!, paint: mats.paint[i]!, offset: i * 21 + (i % 2) * 4 })), [models, mats]);
  const refs = useRef<(THREE.Group | null)[]>([]);
  // The cars are scaled down to fit the diorama.
  const SCALE = 0.55;
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    cars.forEach((c, i) => {
      const g = refs.current[i];
      if (!g) return;
      const p = onRing(t * 4.5 + c.offset, 1.4);
      g.position.set(p.x, 0.05, p.z);
      g.rotation.y = p.heading;
    });
  });
  return (
    <>
      {cars.map((c, i) => (
        <group key={i} ref={(g) => (refs.current[i] = g)} scale={SCALE}>
          <mesh geometry={c.model.paint} material={c.paint} castShadow />
          <mesh geometry={c.model.glass} material={mats.glass} />
          <mesh geometry={c.model.trim} material={mats.trim} />
          <mesh geometry={c.model.chrome} material={mats.chrome} />
          <mesh geometry={c.model.headlights} material={mats.head} />
          <mesh geometry={c.model.taillights} material={mats.tail} />
          {c.model.wheels.map((w, k) => (
            <group key={k} position={[w.x, w.y, w.z]} rotation={[0, w.side < 0 ? Math.PI : 0, 0]}>
              <mesh geometry={c.model.tire} material={mats.tire} />
              <mesh geometry={c.model.rim} material={mats.rim} />
            </group>
          ))}
        </group>
      ))}
    </>
  );
}

/** Little people strolling around the plaza, bobbing as they walk. */
function People() {
  const people = useMemo(
    () =>
      ["#f472b6", "#facc15", "#34d399", "#60a5fa", "#fb923c", "#c084fc"].map((color, i) => ({
        color,
        radius: 3.2 + (i % 3) * 1.1,
        speed: (0.18 + (i % 4) * 0.05) * (i % 2 ? 1 : -1),
        phase: i * 1.3,
      })),
    [],
  );
  const refs = useRef<(THREE.Group | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    people.forEach((p, i) => {
      const g = refs.current[i];
      if (!g) return;
      const a = p.phase + t * p.speed;
      g.position.set(Math.cos(a) * p.radius, Math.abs(Math.sin(t * 7 + i)) * 0.06, Math.sin(a) * p.radius);
      g.rotation.y = -a + (p.speed > 0 ? 0 : Math.PI);
    });
  });
  return (
    <>
      {people.map((p, i) => (
        <group key={i} ref={(g) => (refs.current[i] = g)}>
          <mesh position={[0, 0.45, 0]} castShadow>
            <capsuleGeometry args={[0.18, 0.5, 4, 8]} />
            <meshStandardMaterial color={p.color} />
          </mesh>
          <mesh position={[0, 1.02, 0]} castShadow>
            <sphereGeometry args={[0.16, 12, 10]} />
            <meshStandardMaterial color="#fde68a" />
          </mesh>
        </group>
      ))}
    </>
  );
}

function Fountain() {
  const water = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (water.current) water.current.scale.y = 1 + Math.sin(clock.getElapsedTime() * 3) * 0.15;
  });
  return (
    <group>
      <mesh position={[0, 0.25, 0]} receiveShadow castShadow>
        <cylinderGeometry args={[2, 2.2, 0.5, 32]} />
        <meshStandardMaterial color="#e2e8f0" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.48, 0]}>
        <cylinderGeometry args={[1.75, 1.75, 0.06, 32]} />
        <meshStandardMaterial color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={0.5} roughness={0.1} metalness={0.3} />
      </mesh>
      <mesh ref={water} position={[0, 1.2, 0]}>
        <cylinderGeometry args={[0.08, 0.35, 1.5, 12]} />
        <meshStandardMaterial color="#bae6fd" transparent opacity={0.7} emissive="#38bdf8" emissiveIntensity={0.6} />
      </mesh>
    </group>
  );
}

function Diorama() {
  const root = useRef<THREE.Group>(null);
  const pointer = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: (e.clientX / window.innerWidth) * 2 - 1, y: (e.clientY / window.innerHeight) * 2 - 1 };
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);
  useFrame(({ clock }, dt) => {
    const g = root.current;
    if (!g) return;
    // A slow turntable, nudged by the mouse, with a gentle float.
    const target = clock.getElapsedTime() * 0.08 + pointer.current.x * 0.35;
    g.rotation.y += (target - g.rotation.y) * Math.min(1, dt * 2);
    g.rotation.x += (pointer.current.y * 0.06 - g.rotation.x) * Math.min(1, dt * 2);
    g.position.y = Math.sin(clock.getElapsedTime() * 0.8) * 0.3 - 2;
  });

  const buildings = [
    { x: -14, z: -14, w: 4, d: 4, h: 12, color: "#93c5fd", seed: 3 },
    { x: -8.5, z: -15, w: 4, d: 3, h: 7, color: "#c4b5fd", seed: 7 },
    { x: -2.5, z: -15, w: 4.5, d: 3, h: 15, color: "#a5b4fc", seed: 11 },
    { x: 4, z: -15, w: 4, d: 3, h: 9, color: "#f9a8d4", seed: 13 },
    { x: 14, z: -14, w: 4, d: 4, h: 10, color: "#fdba74", seed: 17 },
    { x: 15, z: -6, w: 3, d: 4, h: 6, color: "#fcd34d", seed: 19 },
    { x: -15, z: 2, w: 3, d: 5, h: 8, color: "#86efac", seed: 23 },
    { x: 15, z: 5, w: 3, d: 5, h: 13, color: "#7dd3fc", seed: 29 },
    { x: 14, z: 14.5, w: 4, d: 3, h: 7, color: "#fca5a5", seed: 31 },
  ];
  const trees: [number, number, number][] = [
    [-14, 9, 1.1], [-11, 13, 0.9], [-15, 15, 1.2], [-8, 15.5, 1], [-3, 15, 0.9], [3, 15.5, 1.1], [8, 15, 0.95],
    [-5.5, -5.5, 0.8], [5.5, -5.5, 0.8], [-5.5, 5.5, 0.8], [5.5, 5.5, 0.8],
  ];

  return (
    <group ref={root}>
      {/* The island: grass top, rock sides, and a soft glow beneath. */}
      <mesh position={[0, -1.5, 0]} receiveShadow>
        <boxGeometry args={[ISLAND * 2 + 2, 3, ISLAND * 2 + 2]} />
        <meshStandardMaterial color="#1e293b" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[ISLAND * 2 + 2, ISLAND * 2 + 2]} />
        <meshStandardMaterial color="#166534" roughness={0.95} />
      </mesh>
      {/* Ring road with lane dashes. */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <ringGeometry args={[(ROAD - 3) * Math.SQRT2, (ROAD + 3) * Math.SQRT2, 4, 1, Math.PI / 4]} />
        <meshStandardMaterial color="#334155" roughness={0.85} />
      </mesh>
      {/* Plaza */}
      <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[(ROAD - 3) * 2, (ROAD - 3) * 2]} />
        <meshStandardMaterial color="#cbd5e1" roughness={0.7} />
      </mesh>
      {Array.from({ length: 4 * 7 }, (_, i) => {
        const side = Math.floor(i / 7);
        const t = -ROAD + 1.5 + (i % 7) * 3.2;
        const pos: [number, number, number] = side === 0 ? [t, 0.04, ROAD] : side === 1 ? [ROAD, 0.04, t] : side === 2 ? [t, 0.04, -ROAD] : [-ROAD, 0.04, t];
        return (
          <mesh key={i} position={pos} rotation={[-Math.PI / 2, 0, side % 2 ? Math.PI / 2 : 0]}>
            <planeGeometry args={[1.4, 0.18]} />
            <meshBasicMaterial color="#f8fafc" />
          </mesh>
        );
      })}
      <Fountain />
      {buildings.map((b, i) => (
        <Building key={i} {...b} />
      ))}
      {trees.map(([x, z, s], i) => (
        <Tree key={i} x={x} z={z} s={s} />
      ))}
      <Cars />
      <People />
    </group>
  );
}
