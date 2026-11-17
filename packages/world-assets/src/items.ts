export type ItemCategory = "furniture" | "decor" | "outdoor" | "lighting";

export interface ItemDefinition {
  id: string;
  name: string;
  category: ItemCategory;
  /** Footprint in meters (x by z) and height, used for rendering and placement validation. */
  width: number;
  depth: number;
  height: number;
  color: string;
  /** Quantity granted in the starter kit when a user claims their first property. */
  starter: number;
}

export const ITEMS: readonly ItemDefinition[] = [
  { id: "chair", name: "Wooden chair", category: "furniture", width: 0.5, depth: 0.5, height: 0.9, color: "#8b5a2b", starter: 4 },
  { id: "table", name: "Dining table", category: "furniture", width: 1.6, depth: 0.9, height: 0.75, color: "#a0703f", starter: 1 },
  { id: "sofa", name: "Sofa", category: "furniture", width: 2.0, depth: 0.9, height: 0.85, color: "#4b6584", starter: 1 },
  { id: "armchair", name: "Armchair", category: "furniture", width: 0.9, depth: 0.9, height: 0.9, color: "#a55eea", starter: 1 },
  { id: "bed", name: "Double bed", category: "furniture", width: 1.6, depth: 2.1, height: 0.6, color: "#d1d8e0", starter: 1 },
  { id: "bookshelf", name: "Bookshelf", category: "furniture", width: 1.0, depth: 0.35, height: 1.9, color: "#6d4c41", starter: 1 },
  { id: "tv", name: "Television", category: "furniture", width: 1.4, depth: 0.4, height: 1.2, color: "#2d3436", starter: 1 },
  { id: "rug", name: "Rug", category: "decor", width: 2.4, depth: 1.6, height: 0.02, color: "#c0392b", starter: 1 },
  { id: "plant", name: "Potted plant", category: "decor", width: 0.5, depth: 0.5, height: 1.1, color: "#27ae60", starter: 2 },
  { id: "painting", name: "Framed painting", category: "decor", width: 1.0, depth: 0.08, height: 0.8, color: "#f39c12", starter: 1 },
  { id: "floor_lamp", name: "Floor lamp", category: "lighting", width: 0.4, depth: 0.4, height: 1.7, color: "#f5f6fa", starter: 1 },
  { id: "garden_bench", name: "Garden bench", category: "outdoor", width: 1.6, depth: 0.6, height: 0.8, color: "#7f8c8d", starter: 1 },
  { id: "bbq", name: "Barbecue grill", category: "outdoor", width: 0.8, depth: 0.6, height: 1.0, color: "#2f3640", starter: 0 },
  { id: "parasol", name: "Garden parasol", category: "outdoor", width: 2.2, depth: 2.2, height: 2.4, color: "#e17055", starter: 0 },
];

export const ITEMS_BY_ID: ReadonlyMap<string, ItemDefinition> = new Map(ITEMS.map((i) => [i.id, i]));

export const STARTER_KIT: readonly { itemId: string; quantity: number }[] = ITEMS.filter((i) => i.starter > 0).map((i) => ({
  itemId: i.id,
  quantity: i.starter,
}));
