import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { getCityLayout, type InteractiveObject } from "@entroworld/world-assets";
import type { GameEngine } from "../core/GameEngine";
import { labelTexture } from "../assets/textures";
import { plainMaterial } from "../assets/materials";

function useLabel(lines: string[], opts: Parameters<typeof labelTexture>[1]) {
  const key = lines.join("\n");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const label = useMemo(() => labelTexture(lines, opts), [key]);
  useEffect(() => () => label.texture.dispose(), [label]);
  return label;
}

function Board({ o }: { o: InteractiveObject }) {
  const label = useLabel([o.label, "Press E to read"], {
    font: "600 34px Georgia, serif",
    color: "#3b2f1e",
    background: "#e6d3ad",
    padding: 22,
    radius: 6,
  });
  return (
    <group position={[o.x, 0, o.z]} rotation={[0, o.rotation, 0]}>
      {[-1.15, 1.15].map((x) => (
        <mesh key={x} position={[x, 1.1, 0]} material={plainMaterial("#5b4632")} castShadow>
          <boxGeometry args={[0.12, 2.2, 0.12]} />
        </mesh>
      ))}
      <mesh position={[0, 1.45, 0]} material={plainMaterial("#6b5138")} castShadow>
        <boxGeometry args={[2.5, 1.5, 0.1]} />
      </mesh>
      <mesh position={[0, 1.45, -0.056]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[2.3, 2.3 / label.aspect]} />
        <meshStandardMaterial map={label.texture} roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.45, 0.056]}>
        <planeGeometry args={[2.3, 2.3 / label.aspect]} />
        <meshStandardMaterial map={label.texture} roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.3, 0]} rotation={[0, 0, 0]} material={plainMaterial("#3f3022")} castShadow>
        <boxGeometry args={[2.7, 0.12, 0.4]} />
      </mesh>
    </group>
  );
}

function Kiosk({ o }: { o: InteractiveObject }) {
  const label = useLabel(["TRANSIT", "Press E"], { font: "700 30px system-ui, sans-serif", color: "#e0f2fe", background: "#0c4a6e", padding: 16, radius: 8 });
  return (
    <group position={[o.x, 0, o.z]} rotation={[0, o.rotation, 0]}>
      <mesh position={[0, 1.1, 0]} material={plainMaterial("#334155", 0.4, 0.5)} castShadow>
        <boxGeometry args={[1.1, 2.2, 1.1]} />
      </mesh>
      {[0, Math.PI / 2, Math.PI, -Math.PI / 2].map((r) => (
        <mesh key={r} position={[Math.sin(r) * 0.56, 1.5, Math.cos(r) * 0.56]} rotation={[0, r, 0]}>
          <planeGeometry args={[0.9, 0.9 / label.aspect]} />
          <meshStandardMaterial map={label.texture} emissiveMap={label.texture} emissive="#ffffff" emissiveIntensity={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 2.35, 0]} material={plainMaterial("#0ea5e9", 0.3, 0.2)}>
        <boxGeometry args={[1.3, 0.12, 1.3]} />
      </mesh>
    </group>
  );
}

function Fountain({ o, engine }: { o: InteractiveObject; engine: GameEngine }) {
  useSyncExternalStore(engine.objectsVersion.subscribe, engine.objectsVersion.get);
  const active = engine.objects.get(o.id)?.active ?? true;
  const jets = useRef<THREE.Group>(null);
  const waterMat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#bfe6ff", transparent: true, opacity: 0.55, roughness: 0.05, metalness: 0.1, depthWrite: false }), []);
  useFrame((_, dt) => {
    const g = jets.current;
    if (!g) return;
    const t = performance.now() / 1000;
    g.children.forEach((c, i) => {
      const s = active ? 1 + Math.sin(t * 6 + i) * 0.06 : Math.max(0.001, c.scale.y - dt * 2);
      c.scale.set(1, s, 1);
      c.visible = s > 0.01;
    });
  });
  const stone = plainMaterial("#c9c2b4", 0.8);
  return (
    <group position={[o.x, 0, o.z]}>
      <mesh position={[0, 0.35, 0]} material={stone} castShadow receiveShadow>
        <cylinderGeometry args={[6.5, 6.7, 0.7, 48, 1, true]} />
      </mesh>
      <mesh position={[0, 0.7, 0]} rotation={[-Math.PI / 2, 0, 0]} material={stone}>
        <ringGeometry args={[6.05, 6.55, 48]} />
      </mesh>
      <mesh position={[0, 0.58, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[6.1, 48]} />
        <meshStandardMaterial color="#5a9bb8" roughness={0.05} metalness={0.25} />
      </mesh>
      <mesh position={[0, 1.6, 0]} material={stone} castShadow>
        <cylinderGeometry args={[0.7, 1.0, 2.0, 24]} />
      </mesh>
      <mesh position={[0, 2.7, 0]} material={stone} castShadow>
        <cylinderGeometry args={[1.8, 1.4, 0.3, 32]} />
      </mesh>
      <mesh position={[0, 3.25, 0]} material={stone} castShadow>
        <cylinderGeometry args={[0.25, 0.4, 0.9, 16]} />
      </mesh>
      <group ref={jets}>
        <mesh position={[0, 4.6, 0]} material={waterMat}>
          <coneGeometry args={[0.35, 2.4, 16, 1, true]} />
        </mesh>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.sin(a) * 3.6, 1.5, Math.cos(a) * 3.6]} rotation={[Math.cos(a) * -0.45, 0, Math.sin(a) * 0.45]} material={waterMat}>
              <cylinderGeometry args={[0.04, 0.12, 2.0, 8, 1, true]} />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

export interface ScreenContent {
  title: string;
  subtitle: string;
}

function Screen({ o, content }: { o: InteractiveObject; content: ScreenContent }) {
  const label = useLabel([content.title, content.subtitle], {
    font: "700 44px system-ui, sans-serif",
    color: "#f8fafc",
    background: "#111827",
    padding: 40,
    radius: 0,
    maxWidth: 900,
  });
  return (
    <group position={[o.x, o.y, o.z]} rotation={[0, o.rotation, 0]}>
      <mesh material={plainMaterial("#1f2937", 0.5, 0.4)} position={[0, 0, -0.25]} castShadow>
        <boxGeometry args={[24.5, 12.5, 0.4]} />
      </mesh>
      <mesh position={[0, 0, 0.0]}>
        <planeGeometry args={[23.5, 11.5]} />
        <meshStandardMaterial map={label.texture} emissiveMap={label.texture} emissive="#ffffff" emissiveIntensity={0.9} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Static meshes for interactive objects (seats are part of the bench props). */
export function Interactives({ engine, screen }: { engine: GameEngine; screen: ScreenContent }) {
  const objects = useMemo(() => getCityLayout().interactives.filter((o) => o.kind !== "seat" && o.kind !== "plotSign"), []);
  return (
    <group>
      {objects.map((o) => {
        switch (o.kind) {
          case "board":
            return <Board key={o.id} o={o} />;
          case "kiosk":
            return <Kiosk key={o.id} o={o} />;
          case "fountain":
            return <Fountain key={o.id} o={o} engine={engine} />;
          case "screen":
            return <Screen key={o.id} o={o} content={screen} />;
          default:
            return null;
        }
      })}
    </group>
  );
}
