import { useEffect, useMemo, useRef, useSyncExternalStore, type Ref, type RefObject } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { ACADEMY_LAB, getCityLayout } from "@entroworld/world-assets";
import type { SimEvent } from "@entroworld/puzzle-engine";
import type { Direction, PuzzleDefinition } from "@entroworld/robot-api";
import type { GameEngine } from "../core/GameEngine";
import { labStore, type LabRun } from "../academy/labStore";
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
      <Room />
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

function Room() {
  const wall = plainMaterial("#dfe7f0", 0.9);
  const trim = plainMaterial("#0ea5e9", 0.4, 0.2);
  const segment = (L.width - L.doorway) / 2;
  const sign = useLabel(["PUZZLE LAB"], { font: "800 64px system-ui, sans-serif", color: "#e0f2fe", background: "#0c4a6e", padding: 28, radius: 10 });
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} receiveShadow>
        <planeGeometry args={[L.width - L.wall * 2, L.depth - L.wall * 2]} />
        <meshStandardMaterial color="#1e293b" roughness={0.55} metalness={0.15} />
      </mesh>
      {/* Back and side walls, and the front wall either side of the doorway (matching the colliders). */}
      <mesh position={[0, L.height / 2, L.depth / 2 - L.wall / 2]} material={wall} castShadow receiveShadow>
        <boxGeometry args={[L.width, L.height, L.wall]} />
      </mesh>
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * (L.width / 2 - L.wall / 2), L.height / 2, 0]} material={wall} castShadow receiveShadow>
            <boxGeometry args={[L.wall, L.height, L.depth]} />
          </mesh>
          <mesh position={[side * (L.doorway / 2 + segment / 2), L.height / 2, -L.depth / 2 + L.wall / 2]} material={wall} castShadow receiveShadow>
            <boxGeometry args={[segment, L.height, L.wall]} />
          </mesh>
        </group>
      ))}
      {/* A coloured band along the top of the walls. */}
      <mesh position={[0, L.height + 0.1, L.depth / 2 - L.wall / 2]} material={trim}>
        <boxGeometry args={[L.width + 0.1, 0.2, L.wall + 0.1]} />
      </mesh>
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * (L.width / 2 - L.wall / 2), L.height + 0.1, 0]} material={trim}>
          <boxGeometry args={[L.wall + 0.1, 0.2, L.depth + 0.1]} />
        </mesh>
      ))}
      <mesh position={[0, L.height + 0.1, -L.depth / 2 + L.wall / 2]} material={trim}>
        <boxGeometry args={[L.width + 0.1, 0.2, L.wall + 0.1]} />
      </mesh>
      {/* Sign above the doorway, facing out. */}
      <mesh position={[0, L.height - 1, -L.depth / 2 - 0.02]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[5, 5 / sign.aspect]} />
        <meshStandardMaterial map={sign.texture} emissiveMap={sign.texture} emissive="#ffffff" emissiveIntensity={0.5} />
      </mesh>
    </group>
  );
}

function Console() {
  const screen = useLabel(["Puzzle Lab", "Press E to code"], { font: "700 40px system-ui, sans-serif", color: "#bae6fd", background: "#082f49", padding: 24, radius: 8 });
  return (
    // Matches the console collider: centered 0.9 m behind the interaction point.
    <group position={[0, 0, L.consoleZ + 0.9]}>
      <mesh position={[0, 0.55, 0]} material={plainMaterial("#334155", 0.5, 0.4)} castShadow receiveShadow>
        <boxGeometry args={[1.6, 1.1, 0.7]} />
      </mesh>
      <mesh position={[0, 1.15, 0.05]} rotation={[-0.5, 0, 0]} material={plainMaterial("#0f172a", 0.3, 0.5)}>
        <boxGeometry args={[1.5, 0.08, 0.7]} />
      </mesh>
      {/* The screen faces the player, who stands on the doorway side (-z). */}
      <mesh position={[0, 1.55, 0.2]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[1.3, 1.3 / screen.aspect]} />
        <meshStandardMaterial map={screen.texture} emissiveMap={screen.texture} emissive="#ffffff" emissiveIntensity={0.8} toneMapped={false} />
      </mesh>
      <mesh position={[0, 1.55, 0.24]} material={plainMaterial("#1f2937", 0.5, 0.4)}>
        <boxGeometry args={[1.45, 1.45 / screen.aspect + 0.1, 0.06]} />
      </mesh>
    </group>
  );
}

// -------------------------------------------------------------------------------------------------
// Board and robot
// -------------------------------------------------------------------------------------------------

const MAX_SPAN = 8 * L.tile;

function Board() {
  const { puzzle, run, resetId } = useSyncExternalStore(labStore.subscribe, labStore.get);
  return (
    <group position={[0, 0, 0]}>
      {/* The projector pad, always there. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, L.boardZ]} receiveShadow>
        <planeGeometry args={[MAX_SPAN + 0.6, MAX_SPAN + 0.6]} />
        <meshStandardMaterial color="#0b1730" roughness={0.4} metalness={0.4} emissive="#0c4a6e" emissiveIntensity={0.25} />
      </mesh>
      {puzzle ? <PuzzleView key={`${resetId}`} puzzle={puzzle} run={run} /> : <IdleRobot />}
    </group>
  );
}

const tileGeometry = new THREE.BoxGeometry(L.tile * 0.94, 0.06, L.tile * 0.94);
const wallGeometry = new THREE.BoxGeometry(L.tile * 0.94, 0.9, L.tile * 0.94);
const batteryGeometry = new THREE.CylinderGeometry(0.16, 0.16, 0.42, 16);

function PuzzleView({ puzzle, run }: { puzzle: PuzzleDefinition; run: LabRun | null }) {
  const cells = useMemo(() => {
    const out: { x: number; y: number; t: string; pos: [number, number] }[] = [];
    puzzle.tiles.forEach((row, y) => [...row].forEach((t, x) => out.push({ x, y, t, pos: cellPos(puzzle, x, y) })));
    return out;
  }, [puzzle]);
  const floor = useMemo(() => new THREE.MeshStandardMaterial({ color: "#1d4ed8", emissive: "#1e3a8a", emissiveIntensity: 0.6, roughness: 0.3, transparent: true, opacity: 0.85 }), []);
  const floorAlt = useMemo(() => new THREE.MeshStandardMaterial({ color: "#2563eb", emissive: "#1e40af", emissiveIntensity: 0.6, roughness: 0.3, transparent: true, opacity: 0.85 }), []);
  const wall = useMemo(() => new THREE.MeshStandardMaterial({ color: "#38bdf8", emissive: "#0284c7", emissiveIntensity: 0.7, transparent: true, opacity: 0.55, depthWrite: false }), []);
  const battery = useMemo(() => new THREE.MeshStandardMaterial({ color: "#4ade80", emissive: "#22c55e", emissiveIntensity: 1.2, toneMapped: false }), []);
  useEffect(
    () => () => {
      for (const m of [floor, floorAlt, wall, battery]) m.dispose();
    },
    [floor, floorAlt, wall, battery],
  );

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
            {t === "#" && <mesh geometry={wallGeometry} material={wall} position={[0, BOARD_Y + 0.45, 0]} />}
            {walkable && (
              <mesh
                ref={(m) => {
                  if (m) batteryMeshes.current.set(cellKey(x, y), m);
                  else batteryMeshes.current.delete(cellKey(x, y));
                }}
                geometry={batteryGeometry}
                material={battery}
                position={[0.3, BOARD_Y + 0.21, 0.3]}
                visible={startBatteries.has(cellKey(x, y))}
                castShadow
              />
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
  const frame = plainMaterial("#e2e8f0", 0.4, 0.3);
  return (
    <group position={[x, BOARD_Y, z]}>
      {[-0.6, 0.6].map((dx) => (
        <mesh key={dx} position={[dx, 0.8, 0.6]} material={frame} castShadow>
          <boxGeometry args={[0.12, 1.6, 0.12]} />
        </mesh>
      ))}
      <mesh position={[0, 1.6, 0.6]} material={frame}>
        <boxGeometry args={[1.32, 0.12, 0.12]} />
      </mesh>
      {/* The glowing panel; it slides up and turns green when the puzzle is solved. */}
      <group ref={ref}>
        <mesh position={[0, 0.78, 0.6]}>
          <planeGeometry args={[1.08, 1.5]} />
          <meshStandardMaterial color="#22d3ee" emissive="#06b6d4" emissiveIntensity={1.4} transparent opacity={0.55} side={THREE.DoubleSide} toneMapped={false} depthWrite={false} />
        </mesh>
      </group>
    </group>
  );
}

// Robot animation timing (seconds).
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
  const anim = useRef({ runId: 0, index: 0, t: 0, from: { ...start }, pose: { ...start }, finale: 0, done: true });

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
      const initial = initialBatteries(puzzle);
      for (const [k, m] of batteries.current) m.visible = initial.has(k);
    }

    let hop = 0;
    let bump = 0;
    let flash = 0;
    if (run && !a.done) {
      a.t += dt;
      const e = run.events[a.index];
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

/** A small wheeled robot, facing +z. */
function RobotModel({ bodyMat }: { bodyMat: THREE.Material }) {
  const dark = plainMaterial("#1e293b", 0.6, 0.3);
  const glow = useMemo(() => new THREE.MeshStandardMaterial({ color: "#67e8f9", emissive: "#22d3ee", emissiveIntensity: 1.6, toneMapped: false }), []);
  useEffect(() => () => glow.dispose(), [glow]);
  return (
    <group>
      {[-0.32, 0.32].map((x) => (
        <mesh key={x} position={[x, 0.16, 0]} rotation={[0, 0, Math.PI / 2]} material={dark} castShadow>
          <cylinderGeometry args={[0.16, 0.16, 0.12, 16]} />
        </mesh>
      ))}
      <mesh position={[0, 0.48, 0]} material={bodyMat} castShadow>
        <boxGeometry args={[0.56, 0.5, 0.5]} />
      </mesh>
      <mesh position={[0, 0.88, 0]} material={bodyMat} castShadow>
        <boxGeometry args={[0.5, 0.32, 0.42]} />
      </mesh>
      {/* Visor and eyes on the front. */}
      <mesh position={[0, 0.88, 0.215]} material={dark}>
        <boxGeometry args={[0.42, 0.2, 0.02]} />
      </mesh>
      {[-0.1, 0.1].map((x) => (
        <mesh key={x} position={[x, 0.89, 0.23]} material={glow}>
          <sphereGeometry args={[0.045, 12, 8]} />
        </mesh>
      ))}
      <mesh position={[0, 0.48, 0.255]} material={glow}>
        <boxGeometry args={[0.2, 0.06, 0.02]} />
      </mesh>
      <mesh position={[0, 1.14, 0]} material={dark}>
        <cylinderGeometry args={[0.015, 0.015, 0.2, 6]} />
      </mesh>
      <mesh position={[0, 1.26, 0]} material={glow}>
        <sphereGeometry args={[0.05, 12, 8]} />
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
