import type { Rect, ZoneId } from "@entroworld/shared";

export type SurfaceKind = "asphalt" | "sidewalk" | "plaza" | "grass" | "sand" | "path" | "wetsand" | "concrete";

export interface Surface {
  id: string;
  kind: SurfaceKind;
  rect: Rect;
  /** Height of the top face above ground (meters). Used for draw order, not collision. */
  y: number;
}

export type FacadeStyle = "glass" | "office" | "brick" | "stucco" | "shop" | "hall" | "house";

export interface Building {
  id: string;
  zoneId: ZoneId;
  chunk: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  /** Rotation around Y in radians (buildings are axis-aligned, so 0 or PI/2 multiples). */
  rotation: number;
  facade: FacadeStyle;
  color: string;
  roof: "flat" | "pitched";
  /** Optional storefront sign shown on the front face (local -z). */
  sign?: string | undefined;
  /** Tower with a narrower top section. */
  setback?: { height: number; inset: number } | undefined;
}

export type PropKind =
  | "tree"
  | "palm"
  | "bush"
  | "lamp"
  | "bench"
  | "planter"
  | "umbrella"
  | "lounger"
  | "picnic"
  | "trash"
  | "statue"
  | "lightTower"
  | "foodTruck"
  | "lifeguard"
  | "volleyNet"
  | "flowerbed";

export interface Prop {
  id: string;
  kind: PropKind;
  chunk: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
  color?: string | undefined;
}

export type InteractiveKind = "seat" | "board" | "kiosk" | "fountain" | "screen" | "plotSign";

export interface InteractiveObject {
  id: string;
  kind: InteractiveKind;
  zoneId: ZoneId;
  chunk: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  /** Max distance (meters) from which a player may interact. */
  radius: number;
  label: string;
  /** Kind-specific data, e.g. the plot id for a plot sign. */
  ref?: string | undefined;
}

export type Collider =
  | {
      kind: "box";
      id: string;
      x: number;
      y: number;
      z: number;
      hx: number;
      hy: number;
      hz: number;
      rotation: number;
    }
  | {
      kind: "cylinder";
      id: string;
      x: number;
      y: number;
      z: number;
      radius: number;
      halfHeight: number;
    };

export interface ZoneLayout {
  id: ZoneId;
  name: string;
  bounds: Rect;
  spawn: { x: number; y: number; z: number; rotation: number };
  ambience: "urban" | "plaza" | "nature" | "beach" | "event" | "residential";
}

export interface Plot {
  id: string;
  zoneId: ZoneId;
  chunk: string;
  number: number;
  /** World-space center of the plot. */
  x: number;
  z: number;
  /** Yaw: the plot's front (street side) faces local -Z rotated by this angle. */
  rotation: number;
  width: number;
  depth: number;
  bounds: Rect;
  house: { width: number; depth: number; centerZ: number; wallHeight: number; doorWidth: number };
}

export interface Venue {
  id: string;
  name: string;
  zoneId: ZoneId;
  x: number;
  y: number;
  z: number;
}

export interface Chunk {
  key: string;
  rect: Rect;
  zoneId: ZoneId;
}

export interface WaterBody {
  id: string;
  kind: "sea" | "pond";
  /** Center and size; ponds are elliptical, the sea is rectangular. */
  x: number;
  z: number;
  width: number;
  depth: number;
}

export interface CityLayout {
  version: number;
  bounds: Rect;
  zones: ZoneLayout[];
  chunks: Chunk[];
  surfaces: Surface[];
  roadMarkings: { x: number; z: number; length: number; width: number; rotation: number }[];
  crosswalks: { x: number; z: number; rotation: number; width: number }[];
  buildings: Building[];
  props: Prop[];
  interactives: InteractiveObject[];
  plots: Plot[];
  venues: Venue[];
  water: WaterBody[];
  colliders: Collider[];
}
