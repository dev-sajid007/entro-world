import type { AnimationState } from "@entroworld/shared";

/** Compact numeric animation codes used in the synchronized state. */
export const AnimCode = {
  IDLE: 0,
  WALKING: 1,
  RUNNING: 2,
  JUMPING: 3,
  FALLING: 4,
  SITTING: 5,
  EMOTING: 6,
} as const satisfies Record<AnimationState, number>;

const BY_CODE: AnimationState[] = ["IDLE", "WALKING", "RUNNING", "JUMPING", "FALLING", "SITTING", "EMOTING"];

export const animFromCode = (code: number): AnimationState => BY_CODE[code] ?? "IDLE";
