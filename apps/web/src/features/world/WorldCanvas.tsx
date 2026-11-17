import { Suspense, useEffect, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import type { PropertyView } from "@entroworld/shared";
import type { GameEngine } from "../../game/core/GameEngine";
import { Atmosphere, Island, RoadMarkings, Surfaces } from "../../game/scenes/Environment";
import { ChunkLayer } from "../../game/scenes/ChunkLayer";
import { Interactives, type ScreenContent } from "../../game/scenes/Interactives";
import { AcademyLab } from "../../game/scenes/AcademyLab";
import { Plots } from "../../game/scenes/Plots";
import { PostEffects, chosenQuality, initialQuality, type GraphicsQuality } from "../../game/scenes/PostEffects";

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

interface Graphics {
  quality: GraphicsQuality;
  dpr: number;
  shadowMapSize: 2048 | 1024;
  shadows: boolean;
}

const MAX_DPR = () => Math.min(window.devicePixelRatio, 1.75);

/**
 * Steps graphics down one notch when the frame rate drops, cheapest-to-lose first: post-processing,
 * extra resolution on high-DPI screens, shadow detail, sub-native resolution, and only then shadows.
 */
function degrade(g: Graphics): Graphics {
  if (g.quality === "high" && chosenQuality() !== "high") return { ...g, quality: "low" };
  if (g.dpr > 1) return { ...g, dpr: Math.max(1, g.dpr - 0.25) };
  if (g.shadowMapSize === 2048) return { ...g, shadowMapSize: 1024 };
  if (g.dpr > 0.75) return { ...g, dpr: 0.75 };
  return { ...g, shadows: false };
}

/** The reverse, when there's headroom again (post-processing stays off to avoid flip-flopping). */
function improve(g: Graphics): Graphics {
  if (!g.shadows) return { ...g, shadows: true };
  if (g.dpr < 1) return { ...g, dpr: Math.min(1, MAX_DPR()) };
  if (g.shadowMapSize === 1024) return { ...g, shadowMapSize: 2048 };
  return { ...g, dpr: Math.min(MAX_DPR(), g.dpr + 0.25) };
}

export function WorldCanvas({ engine, properties, screen }: WorldCanvasProps) {
  const [gfx, setGfx] = useState<Graphics>(() => ({ quality: initialQuality(), dpr: MAX_DPR(), shadowMapSize: 2048, shadows: true }));
  return (
    <Canvas
      shadows={{ type: THREE.PCFShadowMap }}
      dpr={gfx.dpr}
      camera={{ fov: 62, near: 0.25, far: 1800, position: [0, 6, 10] }}
      gl={{ antialias: true, powerPreference: "high-performance", toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
      style={{ position: "absolute", inset: 0, touchAction: "none" }}
      aria-label="3D world view"
    >
      <PerformanceMonitor onDecline={() => setGfx(degrade)} onIncline={() => setGfx(improve)} />
      <EngineLoop engine={engine} />
      <Suspense fallback={null}>
        <Atmosphere engine={engine} shadows={gfx.shadows} shadowMapSize={gfx.shadowMapSize} />
      </Suspense>
      <Island />
      <Surfaces />
      <RoadMarkings />
      <ChunkLayer engine={engine} />
      <Interactives engine={engine} screen={screen} />
      <AcademyLab engine={engine} />
      <Plots properties={properties} />
      <primitive object={engine.root} />
      <PostEffects quality={gfx.quality} />
    </Canvas>
  );
}
