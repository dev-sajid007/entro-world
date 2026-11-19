import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { MODELS, buildModel } from "./carModels";
import { carIdentity } from "./Traffic";

describe("car models", () => {
  for (const [name, spec] of Object.entries(MODELS)) {
    it(`builds a well-formed ${name}`, () => {
      const model = buildModel(spec);
      for (const part of ["paint", "glass", "trim", "chrome", "headlights", "taillights", "tire", "rim"] as const) {
        const pos = model[part].getAttribute("position").array as ArrayLike<number>;
        expect(pos.length, part).toBeGreaterThan(0);
        for (let i = 0; i < pos.length; i++) expect(Number.isFinite(pos[i]!), part).toBe(true);
      }
      const box = new THREE.Box3().setFromBufferAttribute(model.paint.getAttribute("position") as THREE.BufferAttribute);
      const size = box.getSize(new THREE.Vector3());
      // About the car's length, width and roof height, above the road.
      expect(size.z).toBeCloseTo(spec.length, 0);
      expect(size.x).toBeCloseTo(spec.width, 1);
      expect(box.max.y).toBeCloseTo(spec.roof, 0);
      expect(box.min.y).toBeGreaterThan(0.2);
      // Four wheels standing on the ground, two of them steering.
      expect(model.wheels).toHaveLength(4);
      expect(model.wheels.filter((w) => w.front)).toHaveLength(2);
      for (const w of model.wheels) expect(w.y).toBeCloseTo(spec.wheelRadius);
    });
  }
});

describe("car names", () => {
  it("gives every car a fixed name, plate and colour", () => {
    expect(carIdentity(4)).toEqual(carIdentity(4));
    const a = carIdentity(0);
    expect(a.name).toMatch(/^(Velora|Strider|Voyager) \w+$/);
    expect(a.plate).toMatch(/^EW \d{3}$/);
  });

  it("names the first cars differently", () => {
    const names = [0, 1, 2].map((id) => carIdentity(id));
    expect(new Set(names.map((c) => c.name)).size).toBe(3);
    expect(new Set(names.map((c) => c.plate)).size).toBe(3);
  });
});
