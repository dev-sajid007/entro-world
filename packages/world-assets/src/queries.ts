import { type Rect, type ZoneId, distance2D, rectContains } from "@entroworld/shared";
import { getCityLayout, zoneAt, zoneBounds } from "./layout";
import type { InteractiveObject, Plot, ZoneLayout } from "./types";

export function getZoneLayout(zoneId: ZoneId): ZoneLayout {
  const zone = getCityLayout().zones.find((z) => z.id === zoneId);
  if (!zone) throw new Error(`Unknown zone ${zoneId}`);
  return zone;
}

let interactiveIndex: Map<string, InteractiveObject> | null = null;
export function getInteractive(id: string): InteractiveObject | undefined {
  interactiveIndex ??= new Map(getCityLayout().interactives.map((o) => [o.id, o]));
  return interactiveIndex.get(id);
}

let plotIndex: Map<string, Plot> | null = null;
export function getPlot(id: string): Plot | undefined {
  plotIndex ??= new Map(getCityLayout().plots.map((p) => [p.id, p]));
  return plotIndex.get(id);
}

export function interactivesInZone(zoneId: ZoneId): InteractiveObject[] {
  return getCityLayout().interactives.filter((o) => o.zoneId === zoneId);
}

/** Nearest interactive object within its interaction radius of the given point. */
export function findNearestInteractive(x: number, z: number, filter?: (o: InteractiveObject) => boolean): InteractiveObject | null {
  let best: InteractiveObject | null = null;
  let bestDist = Infinity;
  for (const o of getCityLayout().interactives) {
    if (filter && !filter(o)) continue;
    const d = distance2D(x, z, o.x, o.z);
    if (d <= o.radius && d < bestDist) {
      best = o;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Determines which zone a position belongs to, with hysteresis: the player stays in `current`
 * until they are at least `margin` meters inside another zone.
 */
export function resolveZone(current: ZoneId, x: number, z: number, margin = 4): ZoneId {
  if (rectContains(zoneBounds(current), x, z, -margin)) {
    // Still within the current zone (plus margin outside it).
    const candidate = zoneAt(x, z);
    if (candidate === current) return current;
    return rectContains(zoneBounds(candidate), x, z, margin) ? candidate : current;
  }
  return zoneAt(x, z);
}

export function isInsideMap(x: number, z: number, bounds: Rect = getCityLayout().bounds): boolean {
  return rectContains(bounds, x, z, -2);
}
