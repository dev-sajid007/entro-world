import * as THREE from "three";
import { resolveBodyShape } from "@entroworld/avatar";
import type { AnimationState, AvatarConfig } from "@entroworld/shared";
import { whenAvatarAssets, type AvatarAssets } from "../assets/avatarAssets";
import { HumanAvatar } from "./HumanAvatar";
import { ProceduralAvatar } from "./ProceduralAvatar";

/**
 * A player's (or shopkeeper's) avatar. Shows the realistic human once its model files have loaded
 * and the procedural one until then, when they fail to load, when the player picked the classic
 * look (?avatars=classic, remembered), and as the cheap silhouette at the far LOD.
 */
export class AvatarRig {
  readonly root = new THREE.Group();
  private readonly classic: ProceduralAvatar;
  private human: HumanAvatar | null = null;
  private assets: AvatarAssets | null = null;
  private config: AvatarConfig;
  private lod: 0 | 1 = 0;
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(config: AvatarConfig) {
    this.config = config;
    this.classic = new ProceduralAvatar(config);
    this.root.add(this.classic.root);
    this.unsubscribe = realisticAvatarsEnabled()
      ? whenAvatarAssets((assets) => {
          if (this.disposed) return;
          this.assets = assets;
          this.buildHuman();
        })
      : () => undefined;
  }

  private buildHuman(): void {
    if (!this.assets) return;
    try {
      this.human?.dispose();
      this.human = new HumanAvatar(this.assets, this.config);
      this.root.add(this.human.root);
    } catch (e) {
      console.warn("[avatars] couldn't build realistic avatar", e);
      this.human = null;
    }
    this.applyVisibility();
  }

  setConfig(config: AvatarConfig): void {
    const shapeChanged = this.human !== null && resolveBodyShape(config) !== this.human.shape;
    this.config = config;
    this.classic.setConfig(config);
    if (shapeChanged) this.buildHuman();
    else this.human?.setConfig(config);
  }

  /** Switches between the detailed avatar (0) and the low-detail silhouette (1). */
  setLod(level: 0 | 1): void {
    if (level === this.lod) return;
    this.lod = level;
    this.classic.setLod(level);
    this.applyVisibility();
  }

  private applyVisibility(): void {
    const showHuman = this.human !== null && this.lod === 0;
    if (this.human) this.human.root.visible = showHuman;
    this.classic.root.visible = !showHuman;
  }

  /** Footfalls counted from the realistic avatar's feet, or null when it isn't shown. */
  footfalls(): number | null {
    return this.human && this.lod === 0 && this.human.root.visible ? this.human.footfalls : null;
  }

  update(dt: number, state: AnimationState, speed: number, emote: string): void {
    if (this.human && this.lod === 0) this.human.update(dt, state, speed, emote);
    else this.classic.update(dt, state, speed, emote);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.human?.dispose();
    this.classic.dispose();
    this.root.removeFromParent();
  }
}

/** Realistic avatars are on unless turned off with ?avatars=classic (remembered in this browser). */
function realisticAvatarsEnabled(): boolean {
  try {
    const param = new URLSearchParams(window.location.search).get("avatars");
    if (param === "classic" || param === "realistic") localStorage.setItem("ew:avatars", param);
    return localStorage.getItem("ew:avatars") !== "classic";
  } catch {
    return true;
  }
}
