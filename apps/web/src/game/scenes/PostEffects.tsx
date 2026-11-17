import { useEffect } from "react";
import * as THREE from "three";
import { useThree } from "@react-three/fiber";
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";

export type GraphicsQuality = "high" | "low";

/** The quality the player picked with ?gfx=high|low, if any (automatic fallbacks respect it). */
export function chosenQuality(): GraphicsQuality | null {
  try {
    const saved = localStorage.getItem("ew:gfx");
    return saved === "high" || saved === "low" ? saved : null;
  } catch {
    return null;
  }
}

/** Phones, tablets and low-core machines start without post-processing (unless overridden). */
export function initialQuality(): GraphicsQuality {
  if (typeof window === "undefined") return "low";
  // Manual override: ?gfx=high|low (remembered for this browser).
  try {
    const param = new URLSearchParams(window.location.search).get("gfx");
    if (param === "high" || param === "low") localStorage.setItem("ew:gfx", param);
    const saved = localStorage.getItem("ew:gfx");
    if (saved === "high" || saved === "low") return saved;
  } catch {
    // Storage unavailable: fall through to detection.
  }
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  const cores = navigator.hardwareConcurrency ?? 8;
  return coarse || cores <= 4 ? "low" : "high";
}

/**
 * Screen-space effects that do most of the "realistic" work: ambient occlusion grounds buildings,
 * props and avatars; filmic (ACES) tone mapping; a little
 * bloom on highlights, a faint vignette and SMAA. In low quality the renderer tone-maps directly.
 */
export function PostEffects({ quality }: { quality: GraphicsQuality }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    // With the composer, tone mapping happens once at the end of the effect chain.
    gl.toneMapping = quality === "high" ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = quality === "high" ? 1 : 1.05;
  }, [gl, quality]);

  if (quality === "low") return null;
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <N8AO aoRadius={2.5} distanceFalloff={1.2} intensity={2.4} quality="performance" halfRes depthAwareUpsampling color="#1a1f2b" />
      <Bloom mipmapBlur intensity={0.28} luminanceThreshold={0.92} luminanceSmoothing={0.18} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
      <Vignette offset={0.32} darkness={0.32} />
      <SMAA />
    </EffectComposer>
  );
}
