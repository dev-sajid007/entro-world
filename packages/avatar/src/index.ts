import { z } from "zod";
import type { AvatarConfig } from "@entroworld/shared";
import { createRng, hashString, pick } from "@entroworld/shared";
import {
  ACCESSORIES,
  ACCESSORY_SLOTS,
  AVATAR_MODEL_ID,
  BODY_SHAPES,
  BODY_TYPES,
  BOTTOMS,
  CLOTHING_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  MAX_ACCESSORIES,
  SHOES,
  SKIN_TONES,
  TOPS,
} from "./catalog";

export * from "./catalog";
export type { AvatarConfig } from "@entroworld/shared";

const ids = (options: readonly { id: string }[]) => options.map((o) => o.id);
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Expected a #RRGGBB color").transform((s) => s.toLowerCase());
const oneOf = (values: readonly string[], label: string) =>
  z.string().refine((v) => values.includes(v), { message: `Unknown ${label}` });

export const avatarConfigSchema = z
  .object({
    modelId: z.literal(AVATAR_MODEL_ID),
    appearance: z.object({
      skinTone: hexColor.refine((v) => SKIN_TONES.includes(v), { message: "Unknown skin tone" }),
      hairStyle: oneOf(ids(HAIR_STYLES), "hair style"),
      hairColor: hexColor,
      bodyType: oneOf(ids(BODY_TYPES), "body type"),
      bodyShape: oneOf(ids(BODY_SHAPES), "body shape").optional(),
    }),
    clothing: z.object({
      top: oneOf(ids(TOPS), "top"),
      bottom: oneOf(ids(BOTTOMS), "bottom"),
      shoes: oneOf(ids(SHOES), "shoes"),
      topColor: hexColor,
      bottomColor: hexColor,
      shoesColor: hexColor,
    }),
    accessories: z
      .array(oneOf(ids(ACCESSORIES), "accessory"))
      .max(MAX_ACCESSORIES)
      .refine((list) => new Set(list).size === list.length, { message: "Duplicate accessory" })
      .refine(
        (list) => {
          const slots = list.map((a) => ACCESSORY_SLOTS[a]);
          return new Set(slots).size === slots.length;
        },
        { message: "Two accessories occupy the same slot" },
      ),
  })
  .strict();

export function parseAvatarConfig(input: unknown): AvatarConfig {
  return avatarConfigSchema.parse(input);
}

/** Returns a valid avatar config, falling back to a deterministic default for invalid input. */
export function sanitizeAvatarConfig(input: unknown, seed = "default"): AvatarConfig {
  const result = avatarConfigSchema.safeParse(input);
  return result.success ? result.data : generateAvatar(seed);
}

export const DEFAULT_AVATAR: AvatarConfig = {
  modelId: AVATAR_MODEL_ID,
  appearance: { skinTone: "#d9a37f", hairStyle: "short", hairColor: "#3b2a20", bodyType: "regular", bodyShape: "masculine" },
  clothing: {
    top: "hoodie",
    bottom: "jeans",
    shoes: "sneakers",
    topColor: "#334e68",
    bottomColor: "#1f2933",
    shoesColor: "#f5f5f4",
  },
  accessories: [],
};

/** The body shape to render: the saved choice, or a stable pick for avatars saved without one. */
export function resolveBodyShape(config: AvatarConfig): "masculine" | "feminine" {
  const shape = config.appearance.bodyShape;
  if (shape === "masculine" || shape === "feminine") return shape;
  return hashString(JSON.stringify(config)) % 2 === 0 ? "masculine" : "feminine";
}

/** Deterministic avatar generated from a seed (e.g. the username) so new users look distinct. */
export function generateAvatar(seed: string): AvatarConfig {
  const rng = createRng(hashString(seed));
  const avatar: AvatarConfig = {
    modelId: AVATAR_MODEL_ID,
    appearance: {
      skinTone: pick(rng, SKIN_TONES),
      hairStyle: pick(rng, ids(HAIR_STYLES)),
      hairColor: pick(rng, HAIR_COLORS.slice(0, 9)),
      bodyType: pick(rng, ids(BODY_TYPES)),
    },
    clothing: {
      top: pick(rng, ids(TOPS)),
      bottom: pick(rng, ids(BOTTOMS)),
      shoes: pick(rng, ids(SHOES)),
      topColor: pick(rng, CLOTHING_COLORS),
      bottomColor: pick(rng, CLOTHING_COLORS.slice(0, 6)),
      shoesColor: pick(rng, CLOTHING_COLORS.slice(0, 4)),
    },
    accessories: rng() > 0.6 ? [pick(rng, ["glasses", "cap", "headphones", "backpack"])] : [],
  };
  // Picked last so avatars generated before body shapes existed keep their other features.
  avatar.appearance.bodyShape = pick(rng, ids(BODY_SHAPES));
  return avatar;
}
