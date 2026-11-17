export type AnimationState = "IDLE" | "WALKING" | "RUNNING" | "JUMPING" | "FALLING" | "SITTING" | "EMOTING";

export const ANIMATION_STATES: readonly AnimationState[] = [
  "IDLE",
  "WALKING",
  "RUNNING",
  "JUMPING",
  "FALLING",
  "SITTING",
  "EMOTING",
] as const;

export interface AvatarConfig {
  modelId: string;

  appearance: {
    skinTone: string;
    hairStyle: string;
    hairColor: string;
    bodyType: string;
    /** "masculine" | "feminine"; missing in avatars saved before realistic bodies existed. */
    bodyShape?: string;
  };

  clothing: {
    top: string;
    bottom: string;
    shoes: string;
    topColor: string;
    bottomColor: string;
    shoesColor: string;
  };

  accessories: string[];
}
