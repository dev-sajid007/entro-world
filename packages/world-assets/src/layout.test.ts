import { describe, expect, it } from "vitest";
import { ZONE_IDS, rectContains } from "@entroworld/shared";
import { OPEN_SHOP, generateCityLayout, getCityLayout, plotLocalToWorld, worldToPlotLocal, zoneAt } from "./layout";
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

  it("defines every zone with a spawn point inside it", () => {
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
    expect(kioskZones.size).toBe(ZONE_IDS.length);
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
    // AI Agent Street lies west of the Business District.
    expect(resolveZone("zone-business", -250, -80)).toBe("zone-business");
    expect(resolveZone("zone-business", -256, -80)).toBe("zone-market");
  });

  describe("AI Agent Street", () => {
    const blockers = (x: number, z: number, pad: number) =>
      layout.colliders.filter((c) =>
        c.kind === "box" ? pointInBox(c, x, z, pad) : Math.hypot(c.x - x, c.z - z) < c.radius + pad,
      );

    it("has seven shops in zone-market, with Code Corner open", () => {
      expect(layout.shops.map((s) => s.slug).sort()).toEqual(
        ["book-cafe", "career-office", "code-corner", "design-studio", "language-school", "travel-agency", "wellness-corner"],
      );
      for (const shop of layout.shops) expect(zoneAt(shop.x, shop.z)).toBe("zone-market");
      expect(layout.shops.filter((s) => s.open).map((s) => s.slug)).toEqual(["code-corner"]);
    });

    it("puts the shopkeeper behind the counter and the trigger in front of it", () => {
      const shop = layout.shops.find((s) => s.slug === "code-corner")!;
      expect(blockers(shop.keeper.x, shop.keeper.z, 0.35)).toEqual([]);
      expect(blockers(shop.trigger.x, shop.trigger.z, 0.6)).toEqual([]);
      // The counter separates them: walking straight from the trigger to the keeper hits it.
      const steps = 20;
      let blocked = false;
      for (let i = 0; i <= steps; i++) {
        const x = shop.trigger.x + ((shop.keeper.x - shop.trigger.x) * i) / steps;
        const z = shop.trigger.z + ((shop.keeper.z - shop.trigger.z) * i) / steps;
        if (blockers(x, z, 0).length > 0) blocked = true;
      }
      expect(blocked).toBe(true);
      // The keeper faces the customers.
      const fx = -Math.sin(shop.keeper.rotation);
      const fz = -Math.cos(shop.keeper.rotation);
      expect(fx * (shop.trigger.x - shop.keeper.x) + fz * (shop.trigger.z - shop.keeper.z)).toBeGreaterThan(OPEN_SHOP.keeperZ - OPEN_SHOP.triggerZ - 0.01);
      const counter = findNearestInteractive(shop.trigger.x, shop.trigger.z, (o) => o.kind === "shopkeeper");
      expect(counter?.ref).toBe("code-corner");
    });

    it("is reachable from the Business District road", () => {
      // Walk west along z = -80 from the road into the boulevard: nothing blocks the way.
      for (let x = -240; x >= -290; x -= 0.5) expect(blockers(x, -80, 0.35), `blocked at x=${x}`).toEqual([]);
    });

    it("keeps the sea corner south of the annex closed", () => {
      expect(blockers(-290, 0.5, 0).length).toBeGreaterThan(0);
      expect(blockers(-248.5, 40, 0).length).toBeGreaterThan(0);
    });
  });

  it("finds interactives near a point", () => {
    const fountain = findNearestInteractive(0, -72, (o) => o.kind === "fountain");
    expect(fountain?.id).toBe("fountain:central");
    expect(findNearestInteractive(0, 100, (o) => o.kind === "fountain")).toBeNull();
  });
});
