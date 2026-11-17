import { CHARACTER_HEIGHT, MAX_STEP_DISTANCE, SIM } from "./constants";
import type { CharacterSnapshot } from "./physics";

export type MovementVerdict = "ok" | "too_fast" | "fell_out" | "out_of_bounds" | "invalid";

/**
 * Server-side sanity check on the outcome of a simulation step. The server computes movement
 * itself, so this guards against physics glitches (tunneling, NaNs) rather than client data.
 */
export function validateStep(
  before: CharacterSnapshot,
  after: CharacterSnapshot,
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number },
): MovementVerdict {
  for (const v of [after.x, after.y, after.z, after.vy]) if (!Number.isFinite(v)) return "invalid";
  if (after.y < SIM.killPlaneY) return "fell_out";
  const margin = 6;
  if (after.x < bounds.minX - margin || after.x > bounds.maxX + margin || after.z < bounds.minZ - margin || after.z > bounds.maxZ + margin) {
    return "out_of_bounds";
  }
  const horizontal = Math.hypot(after.x - before.x, after.z - before.z);
  if (horizontal > MAX_STEP_DISTANCE) return "too_fast";
  const maxVertical = Math.abs(before.vy) * SIM.dt + SIM.maxStepHeight + SIM.snapToGround + CHARACTER_HEIGHT * 0.1;
  if (Math.abs(after.y - before.y) > maxVertical) return "too_fast";
  return "ok";
}

/** Normalizes a client-provided yaw into [-PI, PI]. */
export function sanitizeYaw(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0;
  const twoPi = Math.PI * 2;
  let r = yaw % twoPi;
  if (r > Math.PI) r -= twoPi;
  if (r < -Math.PI) r += twoPi;
  return r;
}
