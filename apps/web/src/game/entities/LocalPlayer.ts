import * as THREE from "three";
import type { AnimationState, AvatarConfig } from "@entroworld/shared";
import { lerpAngle } from "@entroworld/shared";
import { AnimCode, animFromCode, type InputFrame } from "@entroworld/game-protocol";
import { PredictedCharacter, SIM, deriveAnimation, type Character, type CharacterSnapshot, type PhysicsWorld } from "@entroworld/game-engine";
import { EMOTE_DURATION_MS, type EmoteId } from "@entroworld/avatar";
import { AvatarRig } from "./AvatarRig";
import { ChatBubble, NameTag } from "./Billboards";

export interface ServerPlayerState {
  x: number;
  y: number;
  z: number;
  vy: number;
  grounded: boolean;
  rot: number;
  seq: number;
  anim: number;
  emote: string;
  seatId: string;
}

/**
 * The locally controlled player. Movement is simulated locally every fixed step (client-side
 * prediction); when online, authoritative server states reconcile the prediction and any visual
 * error is smoothed out over a few frames.
 */
export class LocalPlayer {
  readonly root = new THREE.Group();
  readonly rig: AvatarRig;
  readonly tag: NameTag;
  readonly bubble = new ChatBubble();
  readonly predicted: PredictedCharacter;
  private prev: CharacterSnapshot;
  private readonly correction = new THREE.Vector3();
  readonly renderPosition = new THREE.Vector3();
  private renderFacing: number;
  seatId = "";
  private localEmote: { id: EmoteId; until: number } | null = null;
  private serverEmote = "";
  private serverAnim: number = AnimCode.IDLE;
  online = false;
  /** When frozen (zone transfer, seated) no input steps are simulated. */
  frozen = false;

  constructor(
    private readonly physics: PhysicsWorld,
    readonly character: Character,
    displayName: string,
    avatar: AvatarConfig,
  ) {
    this.rig = new AvatarRig(avatar);
    this.tag = new NameTag(displayName, true);
    this.predicted = new PredictedCharacter(physics, character);
    this.root.add(this.rig.root, this.tag.sprite, this.bubble.sprite);
    this.prev = character.snapshot();
    this.renderFacing = character.state.facing;
    this.renderPosition.set(character.state.x, character.state.y, character.state.z);
  }

  get seated(): boolean {
    return this.seatId !== "";
  }

  /** Runs one fixed simulation step. Returns the input frame to send when online. */
  step(buttons: number, yaw: number): InputFrame | null {
    this.prev = this.character.snapshot();
    if (this.frozen || this.seated) return null;
    if (this.localEmote && (buttons & 0b1111) !== 0) this.localEmote = null;
    if (this.online) return this.predicted.applyInput(buttons, yaw);
    this.physics.stepCharacter(this.character, buttons, yaw, SIM.dt);
    if (this.character.state.y < SIM.killPlaneY) this.character.teleport(7, 2, -52);
    return null;
  }

  /** Applies an authoritative state from the server. */
  applyServerState(s: ServerPlayerState): void {
    this.serverAnim = s.anim;
    this.serverEmote = s.emote;
    const wasSeated = this.seated;
    this.seatId = s.seatId;
    if (this.seated) {
      // Seated: the server owns the position entirely.
      this.character.teleport(s.x, s.y, s.z, s.rot);
      this.prev = this.character.snapshot();
      this.predicted.reset();
      this.predicted.lastAckSeq = s.seq;
      if (!wasSeated) this.localEmote = null;
      return;
    }
    const delta = this.predicted.reconcile({ x: s.x, y: s.y, z: s.z, vy: s.vy, grounded: s.grounded, facing: this.character.state.facing, seq: s.seq });
    const err = Math.hypot(delta.dx, delta.dy, delta.dz);
    if (err > 4) {
      // Large corrections (teleports, respawns) snap immediately.
      this.correction.set(0, 0, 0);
      this.prev = this.character.snapshot();
    } else if (err > 0.0005) {
      // Keep the rendered position continuous and decay the error over time.
      this.correction.x -= delta.dx;
      this.correction.y -= delta.dy;
      this.correction.z -= delta.dz;
      this.prev.x += delta.dx;
      this.prev.y += delta.dy;
      this.prev.z += delta.dz;
    }
  }

  teleport(x: number, y: number, z: number, facing: number): void {
    this.character.teleport(x, y, z, facing);
    this.prev = this.character.snapshot();
    this.correction.set(0, 0, 0);
    this.renderFacing = facing;
    this.renderPosition.set(x, y, z);
  }

  playEmote(id: EmoteId, now: number): void {
    this.localEmote = { id, until: now + EMOTE_DURATION_MS[id] };
  }

  get animation(): AnimationState {
    if (this.seated) return "SITTING";
    if (this.online && this.serverAnim === AnimCode.EMOTING && this.serverEmote) return "EMOTING";
    if (this.localEmote) return "EMOTING";
    return animFromCode(deriveAnimation(this.character.state));
  }

  get emote(): string {
    return this.localEmote?.id ?? this.serverEmote;
  }

  update(alpha: number, dt: number, now: number, cameraDistance: number): void {
    if (this.localEmote && now > this.localEmote.until) this.localEmote = null;
    const s = this.character.state;
    // Interpolate between the previous and current fixed steps, then add the decaying correction.
    const k = Math.exp(-dt * 10);
    this.correction.multiplyScalar(k);
    this.renderPosition.set(
      this.prev.x + (s.x - this.prev.x) * alpha + this.correction.x,
      this.prev.y + (s.y - this.prev.y) * alpha + this.correction.y,
      this.prev.z + (s.z - this.prev.z) * alpha + this.correction.z,
    );
    this.renderFacing = lerpAngle(this.renderFacing, s.facing, 1 - Math.exp(-dt * 14));
    this.root.position.copy(this.renderPosition);
    this.rig.root.rotation.y = this.renderFacing;
    const speed = s.moving ? (s.sprinting ? SIM.runSpeed : SIM.walkSpeed) : 0;
    this.rig.update(dt, this.animation, speed, this.emote);
    this.bubble.update(now);
    // Hide our own name tag when the camera is very close.
    this.tag.sprite.visible = cameraDistance > 3;
  }

  dispose(): void {
    this.physics.removeCharacter(this.character);
    this.tag.dispose();
    this.bubble.dispose();
    this.rig.dispose();
    this.root.removeFromParent();
  }
}
