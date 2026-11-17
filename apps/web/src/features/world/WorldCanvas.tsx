import { Suspense, useEffect, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import type { PropertyView } from "@entroworld/shared";
import type { GameEngine } from "../../game/core/GameEngine";
import { Atmosphere, Island, RoadMarkings, Surfaces } from "../../game/scenes/Environment";
import { ChunkLayer } from "../../game/scenes/ChunkLayer";
import { Interactives, type ScreenContent } from "../../game/scenes/Interactives";
import { Plots } from "../../game/scenes/Plots";

/** Drives the engine from the render loop. One frame hook for the whole game. */
function EngineLoop({ engine }: { engine: GameEngine }) {
  const { gl, camera } = useThree();
  useEffect(() => {
    engine.attach(gl.domElement, camera as THREE.PerspectiveCamera);
    return () => engine.detach();
  }, [engine, gl, camera]);
  useFrame((_, dt) => engine.update(dt));
  return null;
}

export interface WorldCanvasProps {
  engine: GameEngine;
  properties: ReadonlyMap<string, PropertyView>;
  screen: ScreenContent;
}

export function WorldCanvas({ engine, properties, screen }: WorldCanvasProps) {
  const [dpr, setDpr] = useState(() => Math.min(window.devicePixelRatio, 1.75));
  const [shadows, setShadows] = useState(true);
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={dpr}
      camera={{ fov: 62, near: 0.25, far: 1800, position: [0, 6, 10] }}
      gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      style={{ position: "absolute", inset: 0, touchAction: "none" }}
      aria-label="3D world view"
    >
      <PerformanceMonitor
        onDecline={() => {
          setDpr((d) => Math.max(0.75, d - 0.25));
          if (dpr <= 1) setShadows(false);
        }}
        onIncline={() => setDpr((d) => Math.min(window.devicePixelRatio, 1.75, d + 0.25))}
      />
      <EngineLoop engine={engine} />
      <Suspense fallback={null}>
        <Atmosphere engine={engine} shadows={shadows} />
      </Suspense>
      <Island />
      <Surfaces />
      <RoadMarkings />
      <ChunkLayer engine={engine} />
      <Interactives engine={engine} screen={screen} />
      <Plots properties={properties} />
      <primitive object={engine.root} />
    </Canvas>
  );
}
