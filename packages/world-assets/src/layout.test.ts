import { describe, expect, it } from "vitest";
import { ZONE_IDS, rectContains } from "@entroworld/shared";
import { generateCityLayout, getCityLayout, plotLocalToWorld, worldToPlotLocal, zoneAt } from "./layout";
import { findNearestInteractive, getPlot, resolveZone } from "./queries";

const pointInBox = (c: { x: number; z: number; hx: number; hz: number; rotation: number }, x: number, z: number, pad = 0) => {
  const dx = x - c.x;
  const dz = z - c.z;
  const cos = Math.cos(-c.rotation);
  const sin = Math.sin(-c.rotation);
  const lx = dx * cos + dz * sin;
  const lz = -dx * sin + dz * cos;
  return Math.abs(lx) <= c.hx + pad && Math.abs(lz) <= c.hz + pad;
};

describe("city layout", () => {
  const layout = getCityLayout();

  it("is deterministic", () => {
    expect(JSON.stringify(generateCityLayout())).toEqual(JSON.stringify(layout));
  });

  it("defines all six zones with spawn points inside them", () => {
    expect(layout.zones.map((z) => z.id).sort()).toEqual([...ZONE_IDS].sort());
    for (const zone of layout.zones) {
      expect(rectContains(zone.bounds, zone.spawn.x, zone.spawn.z)).toBe(true);
      expect(zoneAt(zone.spawn.x, zone.spawn.z)).toBe(zone.id);
    }
  });

  it("keeps spawn points clear of colliders", () => {
    for (const zone of layout.zones) {
      for (const c of layout.colliders) {
        if (c.kind === "box") {
          if (c.id.startsWith("wall-")) continue;
          expect(pointInBox(c, zone.spawn.x, zone.spawn.z, 0.6), `${zone.id} spawn inside ${c.id}`).toBe(false);
        } else {
          expect(Math.hypot(c.x - zone.spawn.x, c.z - zone.spawn.z), `${zone.id} spawn inside ${c.id}`).toBeGreaterThan(c.radius + 0.6);
        }
      }
    }
  });

  it("has only finite collider values", () => {
    for (const c of layout.colliders) {
      for (const v of Object.values(c)) {
        if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("does not place buildings on streets", () => {
    const streetKinds = new Set(["asphalt"]);
    for (const s of layout.surfaces.filter((s) => streetKinds.has(s.kind))) {
      for (const b of layout.buildings) {
        const swap = Math.abs(Math.sin(b.rotation)) > 0.5;
        const hx = (swap ? b.depth : b.width) / 2;
        const hz = (swap ? b.width : b.depth) / 2;
        const overlap = b.x - hx < s.rect.maxX && b.x + hx > s.rect.minX && b.z - hz < s.rect.maxZ && b.z + hz > s.rect.minZ;
        expect(overlap, `${b.id} overlaps street ${s.id}`).toBe(false);
      }
    }
  });

  it("has unique ids", () => {
    const ids = [...layout.buildings, ...layout.props, ...layout.interactives, ...layout.plots, ...layout.colliders].map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("provides property plots, seats, boards, kiosks and venues", () => {
    expect(layout.plots.length).toBe(12);
    const kinds = new Set(layout.interactives.map((i) => i.kind));
    for (const k of ["seat", "board", "kiosk", "fountain", "screen", "plotSign"]) expect(kinds.has(k as never)).toBe(true);
    expect(layout.venues.length).toBeGreaterThanOrEqual(4);
    const kioskZones = new Set(layout.interactives.filter((i) => i.kind === "kiosk").map((k) => k.zoneId));
    expect(kioskZones.size).toBe(6);
  });

  it("round-trips plot-local coordinates", () => {
    for (const plot of layout.plots) {
      const w = plotLocalToWorld(plot, 3, -7);
      const l = worldToPlotLocal(plot, w.x, w.z);
      expect(l.x).toBeCloseTo(3, 6);
      expect(l.z).toBeCloseTo(-7, 6);
      expect(getPlot(plot.id)).toBe(plot);
    }
  });

  it("applies zone hysteresis", () => {
    // Standing 2 m across the central/business border stays in the current zone.
    expect(resolveZone("zone-central", -82, -40)).toBe("zone-central");
    expect(resolveZone("zone-central", -90, -40)).toBe("zone-business");
    expect(resolveZone("zone-business", -78, -40)).toBe("zone-business");
  });

  it("finds interactives near a point", () => {
    const fountain = findNearestInteractive(0, -72, (o) => o.kind === "fountain");
    expect(fountain?.id).toBe("fountain:central");
    expect(findNearestInteractive(0, 100, (o) => o.kind === "fountain")).toBeNull();
  });
});
