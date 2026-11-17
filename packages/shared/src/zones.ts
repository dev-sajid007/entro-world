export const ZONE_IDS = [
  "zone-central",
  "zone-business",
  "zone-residential",
  "zone-park",
  "zone-beach",
  "zone-event",
  "zone-market",
  "zone-academy",
] as const;

export type ZoneId = (typeof ZONE_IDS)[number];

export interface ZoneInfo {
  id: ZoneId;
  name: string;
  description: string;
}

export const ZONES: Record<ZoneId, ZoneInfo> = {
  "zone-central": { id: "zone-central", name: "Central Plaza", description: "Main social hub" },
  "zone-business": { id: "zone-business", name: "Business District", description: "Commercial buildings" },
  "zone-residential": { id: "zone-residential", name: "Residential Area", description: "Houses and apartments" },
  "zone-park": { id: "zone-park", name: "City Park", description: "Social activities" },
  "zone-beach": { id: "zone-beach", name: "Waterfront", description: "Relaxation and events" },
  "zone-event": { id: "zone-event", name: "Event Center", description: "Live events" },
  "zone-market": { id: "zone-market", name: "AI Agent Street", description: "Shops staffed by AI agent NPCs" },
  "zone-academy": { id: "zone-academy", name: "Coding Academy", description: "Classrooms, puzzle labs, challenge arena" },
};

export const DEFAULT_ZONE: ZoneId = "zone-central";

export const isZoneId = (value: unknown): value is ZoneId =>
  typeof value === "string" && (ZONE_IDS as readonly string[]).includes(value);
