export interface CatalogOption {
  id: string;
  label: string;
}

export const AVATAR_MODEL_ID = "humanoid-v1";

export const SKIN_TONES: readonly string[] = [
  "#f6d7c3", "#eac0a0", "#d9a37f", "#c68a63", "#a8714f", "#8a5a3c", "#6b4430", "#4a2f22",
];

export const HAIR_COLORS: readonly string[] = [
  "#1b1b1b", "#3b2a20", "#5a3a22", "#8b5a2b", "#b07d48", "#d8b47a", "#e9d8a6", "#9a9a9a",
  "#e8e8e8", "#a3322b", "#d4572a", "#3a5fcd", "#7a3fbf", "#d94f9b", "#2f9e73",
];

export const CLOTHING_COLORS: readonly string[] = [
  "#1f2933", "#f5f5f4", "#9ca3af", "#334e68", "#1d4ed8", "#0e7490", "#047857", "#65a30d",
  "#ca8a04", "#ea580c", "#b91c1c", "#be185d", "#7e22ce", "#78350f", "#c2b280", "#e8b4b8",
];

export const BODY_TYPES: readonly CatalogOption[] = [
  { id: "slim", label: "Slim" },
  { id: "regular", label: "Regular" },
  { id: "broad", label: "Broad" },
];

/** Which base body the realistic avatar uses. Optional in saved configs (older avatars lack it). */
export const BODY_SHAPES: readonly CatalogOption[] = [
  { id: "masculine", label: "Masculine" },
  { id: "feminine", label: "Feminine" },
];

export const HAIR_STYLES: readonly CatalogOption[] = [
  { id: "bald", label: "Bald" },
  { id: "buzz", label: "Buzz cut" },
  { id: "short", label: "Short" },
  { id: "curly", label: "Curly" },
  { id: "long", label: "Long" },
  { id: "bun", label: "Bun" },
  { id: "ponytail", label: "Ponytail" },
  { id: "mohawk", label: "Mohawk" },
  { id: "afro", label: "Afro" },
];

export const TOPS: readonly CatalogOption[] = [
  { id: "tshirt", label: "T-shirt" },
  { id: "hoodie", label: "Hoodie" },
  { id: "jacket", label: "Jacket" },
  { id: "tank", label: "Tank top" },
  { id: "sweater", label: "Sweater" },
  { id: "blazer", label: "Blazer" },
];

export const BOTTOMS: readonly CatalogOption[] = [
  { id: "jeans", label: "Jeans" },
  { id: "chinos", label: "Chinos" },
  { id: "shorts", label: "Shorts" },
  { id: "skirt", label: "Skirt" },
  { id: "joggers", label: "Joggers" },
];

export const SHOES: readonly CatalogOption[] = [
  { id: "sneakers", label: "Sneakers" },
  { id: "boots", label: "Boots" },
  { id: "loafers", label: "Loafers" },
  { id: "sandals", label: "Sandals" },
];

export const ACCESSORIES: readonly CatalogOption[] = [
  { id: "glasses", label: "Glasses" },
  { id: "sunglasses", label: "Sunglasses" },
  { id: "cap", label: "Cap" },
  { id: "beanie", label: "Beanie" },
  { id: "headphones", label: "Headphones" },
  { id: "backpack", label: "Backpack" },
  { id: "scarf", label: "Scarf" },
  { id: "earrings", label: "Earrings" },
];

/** Accessories that occupy the same slot cannot be combined. */
export const ACCESSORY_SLOTS: Record<string, string> = {
  glasses: "eyes",
  sunglasses: "eyes",
  cap: "head",
  beanie: "head",
  headphones: "ears",
  backpack: "back",
  scarf: "neck",
  earrings: "ears-jewelry",
};

export const MAX_ACCESSORIES = 4;

export const EMOTES = ["wave", "dance", "cheer", "clap", "laugh", "think", "shrug", "bow"] as const;
export type EmoteId = (typeof EMOTES)[number];
export const EMOTE_DURATION_MS: Record<EmoteId, number> = {
  wave: 2500,
  dance: 6000,
  cheer: 2500,
  clap: 3000,
  laugh: 2500,
  think: 3500,
  shrug: 2000,
  bow: 2200,
};
