import * as THREE from "three";
import { clamp } from "@entroworld/shared";
import type { PhysicsWorld } from "@entroworld/game-engine";
import { GROUP_CHARACTER, GROUP_WORLD, groups } from "@entroworld/game-engine";

/**
 * Third-person orbit camera that follows the player. Yaw/pitch come from mouse or touch input;
 * the camera is pulled in when terrain or buildings would block the view.
 */
export class CameraController {
  yaw = 0;
  pitch = -0.32;
  distance = 6.5;
  private currentDistance = 6.5;
  private readonly focus = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private initialized = false;
  sensitivity = 0.0024;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly physics: PhysicsWorld | null,
  ) {}

  applyLook(dx: number, dy: number, zoom: number): void {
    this.yaw -= dx * this.sensitivity;
    this.pitch = clamp(this.pitch - dy * this.sensitivity, -1.25, 0.55);
    if (zoom !== 0) this.distance = clamp(this.distance * (1 + zoom * 0.12), 2.2, 16);
  }

  /** Snaps behind a facing direction (e.g. after teleporting). */
  snapBehind(facing: number): void {
    this.yaw = facing;
    this.initialized = false;
  }

  update(dt: number, target: THREE.Vector3): void {
    const headHeight = 1.55;
    const goal = this.desired.set(target.x, target.y + headHeight, target.z);
    if (!this.initialized) {
      this.focus.copy(goal);
      this.initialized = true;
    } else {
      // Exponential smoothing; vertical smoothing is slower to hide stair steps.
      const k = 1 - Math.exp(-dt * 14);
      const ky = 1 - Math.exp(-dt * 8);
      this.focus.x += (goal.x - this.focus.x) * k;
      this.focus.z += (goal.z - this.focus.z) * k;
      this.focus.y += (goal.y - this.focus.y) * ky;
    }

    const cosP = Math.cos(this.pitch);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * cosP, -Math.sin(this.pitch), Math.cos(this.yaw) * cosP);
    let maxDist = this.distance;
    if (this.physics) {
      const R = this.physics.rapier;
      const ray = new R.Ray({ x: this.focus.x, y: this.focus.y, z: this.focus.z }, { x: dir.x, y: dir.y, z: dir.z });
      const hit = this.physics.world.castRay(ray, this.distance + 0.3, true, undefined, groups(GROUP_CHARACTER, GROUP_WORLD));
      if (hit) maxDist = Math.max(0.6, hit.timeOfImpact - 0.3);
    }
    // Pull in instantly, ease back out.
    this.currentDistance = maxDist < this.currentDistance ? maxDist : this.currentDistance + (maxDist - this.currentDistance) * (1 - Math.exp(-dt * 4));

    this.camera.position.set(
      this.focus.x + dir.x * this.currentDistance,
      Math.max(0.35, this.focus.y + dir.y * this.currentDistance),
      this.focus.z + dir.z * this.currentDistance,
    );
    this.camera.lookAt(this.focus);
  }
}
