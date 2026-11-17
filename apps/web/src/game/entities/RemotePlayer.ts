import * as THREE from "three";
import type { AvatarConfig } from "@entroworld/shared";
import { lerpAngle } from "@entroworld/shared";
import { AnimCode, animFromCode } from "@entroworld/game-protocol";
import { sanitizeAvatarConfig } from "@entroworld/avatar";
import { AvatarRig } from "./AvatarRig";
import { ChatBubble, NameTag } from "./Billboards";

export interface RemoteSnapshot {
  t: number;
  x: number;
  y: number;
  z: number;
  rot: number;
}

const MAX_BUFFER = 40;
const LOD_DISTANCE = 45;
const NAME_DISTANCE = 40;

/**
 * Another player, rendered from server snapshots with entity interpolation: the avatar is drawn
 * slightly in the past (interpolation delay) between the two snapshots that surround that time.
 */
export class RemotePlayer {
  readonly root = new THREE.Group();
  readonly rig: AvatarRig;
  readonly tag: NameTag;
  readonly bubble = new ChatBubble();
  private buffer: RemoteSnapshot[] = [];
  private renderFacing = 0;
  private lastPos = new THREE.Vector3();
  private speed = 0;
  anim: number = AnimCode.IDLE;
  emote = "";
  seatId = "";
  speaking = false;
  voice = false;
  private avatarJson = "";
  private initialized = false;

  constructor(
    readonly sessionId: string,
    public userId: string,
    public displayName: string,
    public username: string,
    avatarJson: string,
  ) {
    this.rig = new AvatarRig(this.parseAvatar(avatarJson));
    this.avatarJson = avatarJson;
    this.tag = new NameTag(displayName);
    this.root.add(this.rig.root, this.tag.sprite, this.bubble.sprite);
  }

  private parseAvatar(json: string): AvatarConfig {
    try {
      return sanitizeAvatarConfig(JSON.parse(json), this.username);
    } catch {
      return sanitizeAvatarConfig(null, this.username);
    }
  }

  setAvatar(json: string): void {
    if (json === this.avatarJson) return;
    this.avatarJson = json;
    this.rig.setConfig(this.parseAvatar(json));
  }

  setDisplayName(name: string): void {
    this.displayName = name;
    this.tag.setText(name);
  }

  push(snapshot: RemoteSnapshot, patchIntervalMs: number): void {
    const last = this.buffer[this.buffer.length - 1];
    if (last && snapshot.t - last.t > patchIntervalMs * 2.5) {
      // The player was idle (no patches); restart interpolation from their last position.
      this.buffer.push({ ...last, t: snapshot.t - patchIntervalMs });
    }
    this.buffer.push(snapshot);
    if (this.buffer.length > MAX_BUFFER) this.buffer.splice(0, this.buffer.length - MAX_BUFFER);
    if (!this.initialized) {
      this.initialized = true;
      this.root.position.set(snapshot.x, snapshot.y, snapshot.z);
      this.renderFacing = snapshot.rot;
      this.lastPos.copy(this.root.position);
    }
  }

  update(renderTime: number, dt: number, now: number, cameraPosition: THREE.Vector3): void {
    const b = this.buffer;
    if (b.length > 0) {
      let target: { x: number; y: number; z: number; rot: number } = b[b.length - 1]!;
      if (renderTime <= b[0]!.t) {
        target = b[0]!;
      } else {
        for (let i = b.length - 1; i > 0; i--) {
          const a = b[i - 1]!;
          const c = b[i]!;
          if (renderTime >= a.t && renderTime <= c.t) {
            const t = (renderTime - a.t) / Math.max(1, c.t - a.t);
            target = { x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t, z: a.z + (c.z - a.z) * t, rot: lerpAngle(a.rot, c.rot, t) };
            break;
          }
        }
      }
      this.root.position.set(target.x, target.y, target.z);
      this.renderFacing = lerpAngle(this.renderFacing, target.rot, 1 - Math.exp(-dt * 12));
      // Drop snapshots older than the interpolation window.
      while (b.length > 2 && b[1]!.t < renderTime - 200) b.shift();
    }
    const moved = Math.hypot(this.root.position.x - this.lastPos.x, this.root.position.z - this.lastPos.z);
    const instantSpeed = dt > 0 ? moved / dt : 0;
    this.speed += (instantSpeed - this.speed) * (1 - Math.exp(-dt * 8));
    this.lastPos.copy(this.root.position);

    this.rig.root.rotation.y = this.renderFacing;
    const distance = cameraPosition.distanceTo(this.root.position);
    this.rig.setLod(distance > LOD_DISTANCE ? 1 : 0);
    this.rig.update(dt, animFromCode(this.anim), this.speed, this.emote);
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
