import { useEffect, useMemo, useRef, useSyncExternalStore, type Ref, type RefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { ACADEMY_LAB, getCityLayout } from "@entroworld/world-assets";
import type { SimEvent } from "@entroworld/puzzle-engine";
import type { Direction, PuzzleDefinition } from "@entroworld/robot-api";
import type { GameEngine } from "../core/GameEngine";
import { labStore, type LabRun } from "../academy/labStore";
import { sfx } from "../audio/Sfx";
import { labelTexture } from "../assets/textures";
import { plainMaterial } from "../assets/materials";

/**
 * The Coding Academy's Puzzle Lab (SPEC-ADDENDUM-01 §3.3): the room, its console, and the
 * holographic puzzle board where the robot companion acts out the learner's program.
 * Everything here is in the lab's local space: the open front at -z, the board toward +z.
 */

const L = ACADEMY_LAB;
/** Height of the board's tile surface above the floor. */
const BOARD_Y = 0.08;

const HEADING: Record<Direction, number> = { N: 0, E: -Math.PI / 2, S: Math.PI, W: Math.PI / 2 };

/** Board cell → lab-local position. North (row 0) is farthest from the console, east is to the right. */
function cellPos(p: PuzzleDefinition, x: number, y: number): [number, number] {
  return [-(x - (p.width - 1) / 2) * L.tile, L.boardZ + ((p.height - 1) / 2 - y) * L.tile];
}

const cellKey = (x: number, y: number) => `${x},${y}`;

function initialBatteries(p: PuzzleDefinition): Set<string> {
  const s = new Set<string>();
  p.tiles.forEach((row, y) => [...row].forEach((t, x) => t === "B" && s.add(cellKey(x, y))));
  return s;
}

export function AcademyLab({ engine }: { engine: GameEngine }) {
  const lab = getCityLayout().academy;
  const { levels } = useSyncExternalStore(engine.chunks.subscribe, engine.chunks.get);
  const level = levels[lab.chunk];
  if (!level || level === "hidden") return null;
  return (
    <group position={[lab.x, 0, lab.z]} rotation={[0, lab.rotation, 0]}>
      <Room detail={level === "high" ? "high" : "low"} />
      <Console />
      <Board />
    </group>
  );
}

// -------------------------------------------------------------------------------------------------
// Room and console
// -------------------------------------------------------------------------------------------------

function useLabel(lines: string[], opts: Parameters<typeof labelTexture>[1]) {
  const key = lines.join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const label = useMemo(() => labelTexture(lines, opts), [key]);
  useEffect(() => () => label.texture.dispose(), [label]);
  return label;
}

// Shared materials and textures. They live as long as the page (the lab is one room), like plainMaterial.
const shared = new Map<string, THREE.Material | THREE.Texture | THREE.BufferGeometry>();
function once<T extends THREE.Material | THREE.Texture | THREE.BufferGeometry>(key: string, make: () => T): T {
  let v = shared.get(key) as T | undefined;
  if (!v) {
    v = make();
    shared.set(key, v);
  }
  return v;
}

/** An unlit-looking light source (LED strips, screens): bright enough to catch the bloom pass. */
const glow = (color: string, intensity = 2) =>
  once(`glow:${color}:${intensity}`, () => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, toneMapped: false }));

function canvasTexture(key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = true): THREE.CanvasTexture {
  return once(`tex:${key}`, () => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d")!);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  });
}

/**
 * Ground surfaces outside are drawn with a strong polygon offset (pulled toward the camera, see
 * Surfaces), which beats the lab floor's few centimetres of height at shallow camera angles: the
 * grass would show through the floor. Everything lying flat in the lab is pulled further.
 */
function overGround<T extends THREE.Material>(m: T, extra = 0): T {
  m.polygonOffset = true;
  m.polygonOffsetFactor = -10 - extra;
  m.polygonOffsetUnits = -20 - extra * 2;
  return m;
}

/** Polished dark floor laid in 1.5 m tiles (one texture repeat = 3 m, four tiles). */
function floorMaterial(): THREE.MeshStandardMaterial {
  return once("mat:floor", () => {
    const map = canvasTexture("floor", 512, 512, (ctx) => {
      // Two slightly different tile tones in a checker, with thin dark joints.
      const tones = ["#141b27", "#111824"];
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          ctx.fillStyle = tones[(i + j) % 2]!;
          ctx.fillRect(i * 256, j * 256, 256, 256);
        }
      }
      ctx.fillStyle = "#0a0f17";
      for (const o of [0, 256]) {
        ctx.fillRect(o, 0, 3, 512);
        ctx.fillRect(0, o, 512, 3);
      }
    }).clone();
    map.needsUpdate = true;
    map.repeat.set((L.width - L.wall * 2) / 3, (L.depth - L.wall * 2) / 3);
    return overGround(new THREE.MeshStandardMaterial({ map, roughness: 0.3, metalness: 0.2 }));
  });
}

/** Vertical oak slats for the feature wall behind the board (one repeat = 1.2 m). */
function slatMaterial(width: number): THREE.MeshStandardMaterial {
  return once(`mat:slats:${width}`, () => {
    const map = canvasTexture("slats", 256, 64, (ctx) => {
      ctx.fillStyle = "#24170f";
      ctx.fillRect(0, 0, 256, 64);
      const tones = ["#a8774b", "#b4845a", "#9b6b42", "#ad7d52"];
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = tones[i % tones.length]!;
        ctx.fillRect(i * 32 + 3, 0, 26, 64);
        ctx.fillStyle = "rgba(255,255,255,0.06)";
        ctx.fillRect(i * 32 + 3, 0, 4, 64);
      }
    }).clone();
    map.needsUpdate = true;
    map.repeat.set(width / 1.2, 1);
    return new THREE.MeshStandardMaterial({ map, roughness: 0.62 });
  });
}

/** Glass curtain wall panes with slim mullions, for the outside of the front wall. */
function glassMaterial(width: number): THREE.MeshStandardMaterial {
  return once(`mat:glass:${width}`, () => {
    const map = canvasTexture("glass", 256, 512, (ctx) => {
      const g = ctx.createLinearGradient(0, 0, 0, 512);
      g.addColorStop(0, "#9cc3e4");
      g.addColorStop(1, "#3d5d7c");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 256, 512);
      ctx.fillStyle = "#1c2430";
      ctx.fillRect(0, 0, 8, 512);
      ctx.fillRect(0, 340, 256, 8);
    }).clone();
    map.needsUpdate = true;
    map.repeat.set(width / 1.6, 1);
    return new THREE.MeshStandardMaterial({ map, roughness: 0.06, metalness: 0.75 });
  });
}

const cladding = () => plainMaterial("#2a313d", 0.72, 0.25);
const plaster = () => plainMaterial("#e9edf2", 0.88);
const steel = () => plainMaterial("#1a202b", 0.4, 0.75);

/** A thin horizontal light strip running along one interior wall. */
function Strip({ x, y, z, length, rotation, color = "#22d3ee" }: { x: number; y: number; z: number; length: number; rotation: number; color?: string }) {
  return (
    <mesh position={[x, y, z]} rotation={[0, rotation, 0]} material={glow(color, 2.2)}>
      <boxGeometry args={[length, 0.04, 0.03]} />
    </mesh>
  );
}

function Room({ detail }: { detail: "high" | "low" }) {
  const segment = (L.width - L.doorway) / 2;
  const innerW = L.width - L.wall * 2;
  const innerD = L.depth - L.wall * 2;
  const back = L.depth / 2 - L.wall - 0.012;
  const side = L.width / 2 - L.wall - 0.012;
  const front = -L.depth / 2 + L.wall + 0.012;
  const sign = useLabel(["</>  PUZZLE LAB"], { font: "800 72px system-ui, sans-serif", color: "#e0f2fe", padding: 18 });
  const finSpacing = segment / 6;

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} material={floorMaterial()} receiveShadow>
        <planeGeometry args={[innerW, innerD]} />
      </mesh>
      {/* A lit walkway inlaid in the floor, from the doorway to the console. */}
      {[-0.9, 0.9].map((x) => (
        <mesh key={x} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.045, (front + L.consoleZ) / 2]} material={once("mat:walkway", () => overGround(glow("#38bdf8", 1.6).clone(), 2))}>
          <planeGeometry args={[0.05, L.consoleZ - front]} />
        </mesh>
      ))}

      {/* Shell: dark cladding outside (matches the colliders), finished surfaces inside. */}
      <mesh position={[0, L.height / 2, L.depth / 2 - L.wall / 2]} material={cladding()} castShadow receiveShadow>
        <boxGeometry args={[L.width, L.height, L.wall]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[s * (L.width / 2 - L.wall / 2), L.height / 2, 0]} material={cladding()} castShadow receiveShadow>
            <boxGeometry args={[L.wall, L.height, L.depth]} />
          </mesh>
          <mesh position={[s * (L.doorway / 2 + segment / 2), L.height / 2, -L.depth / 2 + L.wall / 2]} material={cladding()} castShadow receiveShadow>
            <boxGeometry args={[segment, L.height, L.wall]} />
          </mesh>
          {/* Interior: plaster side walls and front wall. */}
          <mesh position={[s * side, L.height / 2, 0]} rotation={[0, -s * (Math.PI / 2), 0]} material={plaster()} receiveShadow>
            <planeGeometry args={[innerD, L.height]} />
          </mesh>
          <mesh position={[s * (L.doorway / 2 + segment / 2), L.height / 2, front]} material={plaster()} receiveShadow>
            <planeGeometry args={[segment - L.wall, L.height]} />
          </mesh>
          {/* Exterior: glass curtain wall with vertical aluminium fins either side of the entrance. */}
          <mesh position={[s * (L.doorway / 2 + segment / 2), L.height / 2 - 0.2, -L.depth / 2 - 0.015]} rotation={[0, Math.PI, 0]} material={glassMaterial(segment)}>
            <planeGeometry args={[segment, L.height - 0.4]} />
          </mesh>
          {Array.from({ length: 7 }, (_, i) => (
            <mesh key={i} position={[s * (L.doorway / 2 + i * finSpacing), L.height / 2, -L.depth / 2 - 0.2]} material={steel()} castShadow>
              <boxGeometry args={[0.08, L.height, 0.4]} />
            </mesh>
          ))}
          {/* Glowing portal edges on the doorway jambs. */}
          <mesh position={[s * (L.doorway / 2 - 0.02), (L.height - 0.6) / 2, -L.depth / 2 + L.wall / 2]} material={glow("#38bdf8", 2.6)}>
            <boxGeometry args={[0.04, L.height - 0.6, 0.12]} />
          </mesh>
          <Strip x={s * side} y={0.14} z={0} length={innerD} rotation={Math.PI / 2} />
          <Strip x={s * side} y={L.height - 0.3} z={0} length={innerD} rotation={Math.PI / 2} />
          <Strip x={s * (L.doorway / 2 + segment / 2)} y={0.14} z={front} length={segment - L.wall} rotation={0} />
        </group>
      ))}

      {/* Feature wall: oak slats behind the board, with light strips top and bottom. */}
      <mesh position={[0, L.height / 2, back]} rotation={[0, Math.PI, 0]} material={slatMaterial(innerW)} receiveShadow>
        <planeGeometry args={[innerW, L.height]} />
      </mesh>
      <Strip x={0} y={0.14} z={back - 0.02} length={innerW} rotation={0} />
      <Strip x={0} y={L.height - 0.3} z={back - 0.02} length={innerW} rotation={0} color="#fef3c7" />

      {/* Lintel over the entrance with the backlit sign. */}
      <mesh position={[0, L.height - 0.3, -L.depth / 2 + L.wall / 2]} material={cladding()} castShadow>
        <boxGeometry args={[L.doorway + 0.2, 0.6, L.wall + 0.3]} />
      </mesh>
      <mesh position={[0, L.height - 0.3, -L.depth / 2 - 0.17]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[4.2, 4.2 / sign.aspect]} />
        <meshStandardMaterial map={sign.texture} emissiveMap={sign.texture} emissive="#ffffff" emissiveIntensity={1.4} transparent toneMapped={false} />
      </mesh>
      <mesh position={[0, L.height - 0.62, -L.depth / 2 + L.wall / 2]} material={glow("#38bdf8", 2.6)}>
        <boxGeometry args={[L.doorway, 0.04, 0.12]} />
      </mesh>

      {/* Roof: a cantilevered canopy around the edge and open light trusses across the middle. */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[0, L.height + 0.08, s * (L.depth / 2 - 0.6)]} material={steel()} castShadow>
            <boxGeometry args={[L.width + 0.8, 0.16, 2]} />
          </mesh>
          <mesh position={[s * (L.width / 2 - 0.6), L.height + 0.08, 0]} material={steel()} castShadow>
            <boxGeometry args={[2, 0.16, L.depth - 2.4]} />
          </mesh>
          <mesh position={[0, L.height - 0.01, s * (L.depth / 2 - 1.6)]} material={glow("#e0f2fe", 1.8)}>
            <boxGeometry args={[L.width - 3.2, 0.03, 0.05]} />
          </mesh>
        </group>
      ))}
      {[L.boardZ - 3.2, L.boardZ + 3.2].map((z) => (
        <group key={z}>
          <mesh position={[0, L.height - 0.1, z]} material={steel()} castShadow>
            <boxGeometry args={[L.width - 1, 0.3, 0.26]} />
          </mesh>
          <mesh position={[0, L.height - 0.27, z]} material={glow("#f8fafc", 2)}>
            <boxGeometry args={[L.width - 4, 0.04, 0.12]} />
          </mesh>
        </group>
      ))}

      {/* A cool light over the board (skipped at low detail: the room is then only seen from afar). */}
      {detail === "high" && <pointLight position={[0, 4.2, L.boardZ]} color="#7dd3fc" intensity={28} distance={16} decay={2} />}
    </group>
  );
}

function Console() {
  const screen = useLabel(["PUZZLE LAB", "Press E to start coding"], { font: "700 44px system-ui, sans-serif", color: "#e0f2fe", background: "#0b1220", padding: 30, radius: 18 });
  const holo = useRef<THREE.Group>(null);
  useFrame(() => {
    const t = performance.now() / 1000;
    if (holo.current) {
      holo.current.rotation.y = t * 0.8;
      holo.current.position.y = 2.55 + Math.sin(t * 1.6) * 0.05;
    }
  });
  const holoMat = once("mat:holo", () => new THREE.MeshBasicMaterial({ color: "#67e8f9", wireframe: true, transparent: true, opacity: 0.85, toneMapped: false }));
  return (
    // Matches the console collider: centered 0.9 m behind the interaction point.
    <group position={[0, 0, L.consoleZ + 0.9]}>
      <mesh position={[0, 0.04, 0]} material={steel()} receiveShadow>
        <boxGeometry args={[1.6, 0.08, 0.7]} />
      </mesh>
      <mesh position={[0, 0.55, 0.05]} material={plainMaterial("#e5e9ef", 0.35, 0.1)} castShadow receiveShadow>
        <boxGeometry args={[1.0, 0.95, 0.42]} />
      </mesh>
      <mesh position={[0, 0.55, -0.165]} material={glow("#38bdf8", 2.4)}>
        <boxGeometry args={[0.05, 0.8, 0.02]} />
      </mesh>
      {/* Slanted desk with a lit front edge. */}
      <mesh position={[0, 1.08, -0.02]} rotation={[-0.32, 0, 0]} material={plainMaterial("#11161f", 0.25, 0.6)} castShadow>
        <boxGeometry args={[1.6, 0.05, 0.62]} />
      </mesh>
      <mesh position={[0, 0.98, -0.32]} rotation={[-0.32, 0, 0]} material={glow("#38bdf8", 2.4)}>
        <boxGeometry args={[1.5, 0.02, 0.02]} />
      </mesh>
      {/* Thin-bezel screen, facing the player on the doorway side (-z). */}
      <mesh position={[0, 1.72, 0.2]} rotation={[0.12, Math.PI, 0]}>
        <planeGeometry args={[1.4, 1.4 / screen.aspect]} />
        <meshStandardMaterial map={screen.texture} emissiveMap={screen.texture} emissive="#ffffff" emissiveIntensity={1.1} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.72, 0.225]} rotation={[0.12, 0, 0]} material={plainMaterial("#0a0d12", 0.3, 0.6)}>
        <boxGeometry args={[1.44, 1.44 / screen.aspect, 0.03]} />
      </mesh>
      <mesh position={[0, 1.25, 0.26]} material={steel()}>
        <cylinderGeometry args={[0.03, 0.03, 0.3, 8]} />
      </mesh>
      {/* Floating hologram: the console's "logo". */}
      <group ref={holo} position={[0, 2.55, 0.1]}>
        <mesh material={holoMat}>
          <icosahedronGeometry args={[0.16, 0]} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} material={glow("#22d3ee", 2.5)}>
          <torusGeometry args={[0.3, 0.012, 8, 48]} />
        </mesh>
      </group>
    </group>
  );
}

// -------------------------------------------------------------------------------------------------
// Board and robot
// -------------------------------------------------------------------------------------------------

const MAX_SPAN = 8 * L.tile;

function Board() {
  const { puzzle, run, resetId } = useSyncExternalStore(labStore.subscribe, labStore.get);
  const scan = useRef<THREE.Mesh>(null);
  const pad = MAX_SPAN + 0.8;
  useFrame(() => {
    // A projector scan line sweeps the board while a puzzle is loaded.
    if (!scan.current) return;
    scan.current.visible = puzzle !== null;
    const t = (performance.now() / 4000) % 1;
    scan.current.position.z = L.boardZ - MAX_SPAN / 2 + t * MAX_SPAN;
  });
  return (
    <group>
      {/* The projector platform, always there: a dark slab with a lit rim and corner emitters. */}
      <mesh position={[0, 0.03, L.boardZ]} material={once("mat:pad", () => overGround(new THREE.MeshStandardMaterial({ color: "#0a111c", roughness: 0.3, metalness: 0.7 }), 2))} receiveShadow>
        <boxGeometry args={[pad, 0.06, pad]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[0, 0.065, L.boardZ + s * (pad / 2 - 0.05)]} material={glow("#38bdf8", 2.4)}>
            <boxGeometry args={[pad, 0.015, 0.05]} />
          </mesh>
          <mesh position={[s * (pad / 2 - 0.05), 0.065, L.boardZ]} material={glow("#38bdf8", 2.4)}>
            <boxGeometry args={[0.05, 0.015, pad]} />
          </mesh>
          {[-1, 1].map((t) => (
            <group key={t} position={[s * (pad / 2 + 0.25), 0, L.boardZ + t * (pad / 2 + 0.25)]}>
              <mesh position={[0, 0.3, 0]} material={steel()} castShadow>
                <boxGeometry args={[0.22, 0.6, 0.22]} />
              </mesh>
              <mesh position={[0, 0.62, 0]} material={glow("#67e8f9", 3)}>
                <boxGeometry args={[0.16, 0.04, 0.16]} />
              </mesh>
            </group>
          ))}
        </group>
      ))}
      <mesh ref={scan} position={[0, BOARD_Y + 0.02, L.boardZ]} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <planeGeometry args={[MAX_SPAN, 0.08]} />
        <meshBasicMaterial color="#67e8f9" transparent opacity={0.45} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
      {puzzle ? <PuzzleView key={`${resetId}`} puzzle={puzzle} run={run} /> : <IdleRobot />}
    </group>
  );
}

const tileGeometry = new THREE.BoxGeometry(L.tile * 0.94, 0.06, L.tile * 0.94);
const wallGeometry = new THREE.BoxGeometry(L.tile * 0.9, 0.9, L.tile * 0.9);
const wallEdges = new THREE.EdgesGeometry(wallGeometry);
const batteryGeometry = new THREE.CapsuleGeometry(0.12, 0.2, 6, 16);
const batteryRingGeometry = new THREE.TorusGeometry(0.15, 0.025, 8, 24);

/** A holographic floor tile: dark glass with a glowing outline. */
function tileMaterial(alt: boolean): THREE.MeshStandardMaterial {
  return once(`mat:tile:${alt}`, () => {
    const map = canvasTexture(`tile:${alt}`, 128, 128, (ctx) => {
      ctx.fillStyle = alt ? "#0c2747" : "#0a1f3a";
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = "#38bdf8";
      ctx.lineWidth = 5;
      ctx.strokeRect(4, 4, 120, 120);
      ctx.fillStyle = "#7dd3fc";
      for (const [x, y] of [[10, 10], [110, 10], [10, 110], [110, 110]] as const) ctx.fillRect(x, y, 8, 8);
    }, false);
    return overGround(new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: "#ffffff", emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.94 }), 4);
  });
}

function PuzzleView({ puzzle, run }: { puzzle: PuzzleDefinition; run: LabRun | null }) {
  const cells = useMemo(() => {
    const out: { x: number; y: number; t: string; pos: [number, number] }[] = [];
    puzzle.tiles.forEach((row, y) => [...row].forEach((t, x) => out.push({ x, y, t, pos: cellPos(puzzle, x, y) })));
    return out;
  }, [puzzle]);
  const floor = tileMaterial(false);
  const floorAlt = tileMaterial(true);
  const wall = once("mat:holoWall", () => new THREE.MeshStandardMaterial({ color: "#38bdf8", emissive: "#0284c7", emissiveIntensity: 0.6, transparent: true, opacity: 0.22, depthWrite: false }));
  const wallEdge = once("mat:holoEdge", () => new THREE.LineBasicMaterial({ color: "#a5f3fc", toneMapped: false }));
  const battery = glow("#4ade80", 2.2);
  const ring = glow("#f0fdf4", 1.5);

  /** Battery meshes for every walkable cell; visibility tracks the simulation as the run plays. */
  const batteryMeshes = useRef(new Map<string, THREE.Mesh>());
  const startBatteries = useMemo(() => initialBatteries(puzzle), [puzzle]);
  const goal = puzzle.goal.reach;
  const door = useRef<THREE.Group>(null);

  return (
    <group>
      {cells.map(({ x, y, t, pos: [lx, lz] }) => {
        if (t === "~") return null;
        const walkable = t === "." || t === "B";
        return (
          <group key={cellKey(x, y)} position={[lx, 0, lz]}>
            <mesh geometry={tileGeometry} material={(x + y) % 2 ? floorAlt : floor} position={[0, BOARD_Y - 0.03, 0]} receiveShadow />
            {t === "#" && (
              <group position={[0, BOARD_Y + 0.45, 0]}>
                <mesh geometry={wallGeometry} material={wall} />
                <lineSegments geometry={wallEdges} material={wallEdge} />
              </group>
            )}
            {walkable && (
              <mesh
                ref={(m) => {
                  if (m) batteryMeshes.current.set(cellKey(x, y), m);
                  else batteryMeshes.current.delete(cellKey(x, y));
                }}
                geometry={batteryGeometry}
                material={battery}
                position={[0.3, BOARD_Y + 0.25, 0.3]}
                visible={startBatteries.has(cellKey(x, y))}
                castShadow
              >
                <mesh geometry={batteryRingGeometry} material={ring} rotation={[Math.PI / 2, 0, 0]} />
              </mesh>
            )}
          </group>
        );
      })}
      {goal && <ExitDoor ref={door} position={cellPos(puzzle, goal.x, goal.y)} />}
      <Robot puzzle={puzzle} run={run} batteries={batteryMeshes} door={door} />
    </group>
  );
}

function ExitDoor({ ref, position: [x, z] }: { ref: Ref<THREE.Group>; position: [number, number] }) {
  return (
    <group position={[x, BOARD_Y, z]}>
      {/* A portal frame: two slim pillars with lit inner edges and a top beam. */}
      {[-0.6, 0.6].map((dx) => (
        <group key={dx} position={[dx, 0, 0.6]}>
          <mesh position={[0, 0.85, 0]} material={steel()} castShadow>
            <boxGeometry args={[0.12, 1.7, 0.14]} />
          </mesh>
          <mesh position={[-Math.sign(dx) * 0.065, 0.85, 0]} material={glow("#34d399", 2.6)}>
            <boxGeometry args={[0.015, 1.6, 0.06]} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 1.72, 0.6]} material={steel()} castShadow>
        <boxGeometry args={[1.34, 0.12, 0.14]} />
      </mesh>
      {/* The goal ring on the tile. */}
      <mesh position={[0, 0.04, 0]} rotation={[-Math.PI / 2, 0, 0]} material={glow("#34d399", 2)}>
        <ringGeometry args={[0.48, 0.56, 40]} />
      </mesh>
      {/* The glowing panel; it slides up when the puzzle is solved. */}
      <group ref={ref}>
        <mesh position={[0, 0.82, 0.6]}>
          <planeGeometry args={[1.08, 1.56]} />
          <meshStandardMaterial color="#22d3ee" emissive="#06b6d4" emissiveIntensity={1.4} transparent opacity={0.5} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

// Robot animation timing (seconds).
const tmpPos = new THREE.Vector3();
const DURATION: Record<SimEvent["type"], number> = { move: 0.32, jump: 0.55, turn: 0.26, pickUp: 0.4, drop: 0.4, say: 0.9, blocked: 0.55 };
const FINALE = 1.4;

interface Pose {
  x: number;
  y: number;
  heading: number;
}

function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function Robot({
  puzzle,
  run,
  batteries,
  door,
}: {
  puzzle: PuzzleDefinition;
  run: LabRun | null;
  batteries: RefObject<Map<string, THREE.Mesh>>;
  door: RefObject<THREE.Group | null>;
}) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const bodyMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f1f5f9", roughness: 0.35, metalness: 0.2, emissive: "#ef4444", emissiveIntensity: 0 }), []);
  useEffect(() => () => bodyMat.dispose(), [bodyMat]);

  const start: Pose = useMemo(() => ({ x: puzzle.start.x, y: puzzle.start.y, heading: HEADING[puzzle.start.dir] }), [puzzle]);
  const anim = useRef({ runId: 0, index: 0, t: 0, from: { ...start }, pose: { ...start }, finale: 0, done: true, sounded: -1 });

  useFrame((_, rawDt) => {
    const g = root.current;
    const b = body.current;
    if (!g || !b) return;
    const dt = Math.min(rawDt, 0.1);
    const a = anim.current;

    // A new run starts from the beginning: robot on its start tile, batteries back in place.
    if (run && run.id !== a.runId) {
      a.runId = run.id;
      a.index = 0;
      a.t = -0.2;
      a.from = { ...start };
      a.pose = { ...start };
      a.finale = 0;
      a.done = false;
      a.sounded = -1;
      const initial = initialBatteries(puzzle);
      for (const [k, m] of batteries.current) m.visible = initial.has(k);
    }

    let hop = 0;
    let bump = 0;
    let flash = 0;
    if (run && !a.done) {
      a.t += dt;
      const e = run.events[a.index];
      if (e && a.t >= 0 && a.sounded !== a.index) {
        a.sounded = a.index;
        const s = sfx.spatial(g.getWorldPosition(tmpPos).x, tmpPos.z, 30);
        sfx.robot(e.type, s.pan, s.gain);
      }
      if (e) {
        const p = Math.max(0, Math.min(1, a.t / DURATION[e.type]));
        const s = p * p * (3 - 2 * p);
        switch (e.type) {
          case "move":
          case "jump":
            a.pose.x = a.from.x + (e.x - a.from.x) * s;
            a.pose.y = a.from.y + (e.y - a.from.y) * s;
            if (e.type === "jump") hop = Math.sin(Math.PI * p) * 0.9;
            break;
          case "turn":
            a.pose.heading = a.from.heading + shortestAngle(a.from.heading, HEADING[e.dir]) * s;
            break;
          case "pickUp":
          case "drop":
            hop = -Math.sin(Math.PI * p) * 0.12;
            if (p >= 0.5 && e.ok) {
              const m = batteries.current.get(cellKey(e.x, e.y));
              if (m) m.visible = e.type === "drop";
            }
            break;
          case "say":
            hop = Math.abs(Math.sin(Math.PI * 3 * p)) * 0.12;
            break;
          case "blocked":
            bump = Math.sin(Math.PI * p) * 0.3;
            flash = Math.sin(Math.PI * p);
            break;
        }
        if (p >= 1) {
          if (e.type === "move" || e.type === "jump") Object.assign(a.pose, { x: e.x, y: e.y });
          if (e.type === "turn") a.pose.heading = HEADING[e.dir];
          a.from = { ...a.pose };
          a.index++;
          a.t = 0;
        }
      } else {
        // The finale: a happy spin and an opening door, or a sad shake.
        if (a.finale === 0) {
          if (run.outcome === "success") sfx.success();
          else sfx.failure();
        }
        a.finale += dt;
        const p = Math.min(1, a.finale / FINALE);
        if (run.outcome === "success") {
          hop = Math.abs(Math.sin(Math.PI * 2 * p)) * 0.35;
          a.pose.heading = a.from.heading + Math.PI * 2 * (p * p * (3 - 2 * p));
          if (door.current) door.current.position.y = Math.min(1, p * 1.5) * 1.5;
        } else {
          a.pose.heading = a.from.heading + Math.sin(p * Math.PI * 6) * 0.25 * (1 - p);
        }
        if (p >= 1) {
          a.pose.heading = a.from.heading;
          a.done = true;
          labStore.finish(run.id);
        }
      }
    } else if (!run) {
      // Idle: a gentle bob on the start tile.
      hop = Math.sin(performance.now() / 400) * 0.03;
    }

    const [lx, lz] = cellPos(puzzle, a.pose.x, a.pose.y);
    g.position.set(lx + Math.sin(a.pose.heading) * bump * L.tile, BOARD_Y + Math.max(hop, -0.12), lz + Math.cos(a.pose.heading) * bump * L.tile);
    g.rotation.y = a.pose.heading;
    bodyMat.emissiveIntensity = flash * 0.8;
  });

  return (
    <group ref={root}>
      <group ref={body} scale={0.9}>
        <RobotModel bodyMat={bodyMat} />
      </group>
    </group>
  );
}

/** A small hovering robot with a rounded shell and a glass visor, facing +z. */
function RobotModel({ bodyMat }: { bodyMat: THREE.Material }) {
  const dark = plainMaterial("#151a23", 0.25, 0.7);
  const visor = once("mat:visor", () => new THREE.MeshStandardMaterial({ color: "#05070b", roughness: 0.05, metalness: 0.9 }));
  const eyes = glow("#67e8f9", 3);
  const hover = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (hover.current) hover.current.scale.setScalar(1 + Math.sin(performance.now() / 180) * 0.06);
  });
  return (
    <group>
      {/* Hover drive: a glowing ring under a small base instead of wheels. */}
      <mesh ref={hover} position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]} material={glow("#22d3ee", 2.8)}>
        <torusGeometry args={[0.2, 0.025, 8, 32]} />
      </mesh>
      <mesh position={[0, 0.18, 0]} material={dark} castShadow>
        <cylinderGeometry args={[0.2, 0.26, 0.12, 24]} />
      </mesh>
      {/* Rounded body and head. */}
      <mesh position={[0, 0.5, 0]} material={bodyMat} castShadow>
        <capsuleGeometry args={[0.26, 0.22, 8, 24]} />
      </mesh>
      <mesh position={[0, 0.5, 0.25]} material={eyes}>
        <boxGeometry args={[0.16, 0.025, 0.02]} />
      </mesh>
      <mesh position={[0, 0.98, 0]} scale={[1, 0.82, 0.92]} material={bodyMat} castShadow>
        <sphereGeometry args={[0.26, 32, 20]} />
      </mesh>
      {/* Visor (a flattened capsule across the face) with two eyes. */}
      <mesh position={[0, 0.99, 0.17]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.6]} material={visor}>
        <capsuleGeometry args={[0.1, 0.2, 6, 16]} />
      </mesh>
      {[-0.08, 0.08].map((x) => (
        <mesh key={x} position={[x, 1.0, 0.235]} rotation={[0, 0, Math.PI / 2]} material={eyes}>
          <capsuleGeometry args={[0.022, 0.03, 4, 8]} />
        </mesh>
      ))}
      {/* Arms. */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.32, 0.5, 0.02]} rotation={[0.25, 0, s * 0.18]} material={dark} castShadow>
          <capsuleGeometry args={[0.055, 0.22, 4, 12]} />
        </mesh>
      ))}
      <mesh position={[0, 1.25, 0]} material={dark}>
        <cylinderGeometry args={[0.012, 0.012, 0.16, 6]} />
      </mesh>
      <mesh position={[0, 1.35, 0]} material={eyes}>
        <sphereGeometry args={[0.04, 12, 8]} />
      </mesh>
    </group>
  );
}

/** Before a lesson is opened, the robot waits in the middle of the pad. */
function IdleRobot() {
  const g = useRef<THREE.Group>(null);
  const bodyMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#f1f5f9", roughness: 0.35, metalness: 0.2 }), []);
  useEffect(() => () => bodyMat.dispose(), [bodyMat]);
  useFrame(() => {
    const t = performance.now() / 1000;
    if (g.current) {
      g.current.position.y = 0.06 + Math.sin(t * 2.5) * 0.03;
      g.current.rotation.y = Math.PI + Math.sin(t * 0.6) * 0.6;
    }
  });
  return (
    <group ref={g} position={[0, 0.06, L.boardZ]} scale={0.9}>
      <RobotModel bodyMat={bodyMat} />
    </group>
  );
}
