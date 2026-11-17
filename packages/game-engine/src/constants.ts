export const SIM = {
  /** Fixed simulation step (seconds). Client and server both advance movement in these steps. */
  dt: 1 / 60,
  gravity: -26,
  walkSpeed: 4.4,
  runSpeed: 8.4,
  jumpSpeed: 8.8,
  maxFallSpeed: 55,
  capsuleRadius: 0.35,
  capsuleHalfHeight: 0.55,
  controllerOffset: 0.02,
  maxStepHeight: 0.45,
  snapToGround: 0.35,
  maxSlopeClimbDeg: 50,
  /** Air time before the animation switches from grounded to falling. */
  coyoteTime: 0.12,
  /** Below this height the character is considered out of the world and respawned. */
  killPlaneY: -30,
} as const;

/** Distance from the feet to the capsule center. */
export const CHARACTER_CENTER_Y = SIM.capsuleRadius + SIM.capsuleHalfHeight;
export const CHARACTER_HEIGHT = CHARACTER_CENTER_Y * 2;

/** Max horizontal distance a single step may move the character (with tolerance). */
export const MAX_STEP_DISTANCE = SIM.runSpeed * SIM.dt * 1.25 + 0.02;

/** Collision groups: statics are "world"; characters only collide with the world, not each other. */
export const GROUP_WORLD = 0x0001;
export const GROUP_CHARACTER = 0x0002;
export const groups = (membership: number, filter: number): number => ((membership & 0xffff) << 16) | (filter & 0xffff);
