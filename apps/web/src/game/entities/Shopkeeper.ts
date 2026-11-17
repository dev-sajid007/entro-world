import * as THREE from "three";
import type { AvatarConfig } from "@entroworld/shared";
import { lerpAngle } from "@entroworld/shared";
import { sanitizeAvatarConfig } from "@entroworld/avatar";
import type { NpcStateShape } from "@entroworld/game-protocol";
import { AvatarRig } from "./AvatarRig";
import { ChatBubble, NameTag } from "./Billboards";

const NAME_DISTANCE = 40;
const LOD_DISTANCE = 45;

/** Pose per server animation state; "idle" uses the rig's own idle. */
const POSES: Record<string, string> = { thinking: "think", talking: "talk", listening: "listen" };

/**
 * An AI shopkeeper NPC. Its animation state comes from the game server (which hears from the AI
 * agent service), so everyone in the shop sees it think and talk. It is always labelled as AI.
 */
export class Shopkeeper {
  readonly root = new THREE.Group();
  readonly rig: AvatarRig;
  readonly tag: NameTag;
  readonly bubble = new ChatBubble();
  anim = "idle";
  private targetRot: number;
  private facing: number;
  private avatarJson: string;
  private thinkingShown = false;

  constructor(
    readonly id: string,
    readonly agentId: string,
    readonly shopSlug: string,
    public name: string,
    state: NpcStateShape,
  ) {
    this.avatarJson = state.avatar;
    this.rig = new AvatarRig(this.parseAvatar(state.avatar));
    this.tag = new NameTag(`AI · ${name}`, true);
    this.root.add(this.rig.root, this.tag.sprite, this.bubble.sprite);
    this.root.position.set(state.x, state.y, state.z);
    this.facing = this.targetRot = state.rot;
    this.apply(state);
  }

  private parseAvatar(json: string): AvatarConfig {
    try {
      return sanitizeAvatarConfig(JSON.parse(json), this.shopSlug);
    } catch {
      return sanitizeAvatarConfig(null, this.shopSlug);
    }
  }

  apply(state: NpcStateShape): void {
    this.root.position.set(state.x, state.y, state.z);
    this.targetRot = state.rot;
    this.anim = state.anim;
    if (state.name !== this.name) {
      this.name = state.name;
      this.tag.setText(`AI · ${state.name}`);
    }
    if (state.avatar !== this.avatarJson) {
      this.avatarJson = state.avatar;
      this.rig.setConfig(this.parseAvatar(state.avatar));
    }
  }

  /** Shows a speech bubble (e.g. the greeting when the local player walks up). */
  say(text: string, now: number, durationMs?: number): void {
    this.bubble.show(text, now, durationMs);
  }

  update(dt: number, now: number, cameraPosition: THREE.Vector3): void {
    this.facing = lerpAngle(this.facing, this.targetRot, 1 - Math.exp(-dt * 10));
    this.rig.root.rotation.y = this.facing;
    const distance = cameraPosition.distanceTo(this.root.position);
    this.rig.setLod(distance > LOD_DISTANCE ? 1 : 0);
    const pose = POSES[this.anim];
    this.rig.update(dt, pose ? "EMOTING" : "IDLE", 0, pose ?? "");
    // A thinking bubble everyone in the shop can see; the answer itself stays in the chat panel.
    if (this.anim === "thinking" && !this.thinkingShown) {
      this.thinkingShown = true;
      this.bubble.show("…", now, 60_000);
    } else if (this.anim !== "thinking" && this.thinkingShown) {
      this.thinkingShown = false;
      this.bubble.show("…", now, 0);
    }
    this.tag.sprite.visible = distance < NAME_DISTANCE;
    this.bubble.update(now);
  }

  dispose(): void {
    this.tag.dispose();
    this.bubble.dispose();
    this.rig.dispose();
    this.root.removeFromParent();
  }
}
