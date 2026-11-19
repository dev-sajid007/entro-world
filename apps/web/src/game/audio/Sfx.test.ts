import { describe, expect, it } from "vitest";
import { sfx } from "./Sfx";
import { surfaceSoundAt } from "./GameSounds";

describe("sound engine", () => {
  it("is silent and harmless before the browser allows audio", () => {
    // No AudioContext yet: every sound is a no-op rather than an error.
    expect(() => {
      sfx.footstep("hard");
      sfx.jump();
      sfx.success();
      sfx.robot("blocked");
      sfx.setAmbience("beach");
      sfx.engineLoop().set(1, 0, 1);
    }).not.toThrow();
  });

  it("pans and fades world sounds by distance from the camera", () => {
    // Camera at the origin, its right side towards +x.
    sfx.setListener(0, 0, 1, 0);
    const near = sfx.spatial(2, 0);
    const far = sfx.spatial(30, 0);
    expect(near.gain).toBeGreaterThan(far.gain);
    expect(near.pan).toBeGreaterThan(0);
    expect(sfx.spatial(-10, 0).pan).toBeLessThan(0);
    expect(sfx.spatial(500, 0).gain).toBe(0);
  });

  it("remembers mute and volume", () => {
    sfx.setVolume(0.3);
    expect(sfx.volume).toBeCloseTo(0.3);
    sfx.setMuted(true);
    expect(sfx.getSnapshot()).toEqual({ muted: true, volume: 0.3 });
    sfx.setVolume(2);
    expect(sfx.getSnapshot()).toEqual({ muted: false, volume: 1 });
  });

  it("knows what the ground sounds like", () => {
    // Roads are asphalt; far out of the city there's no surface, so grass.
    expect(surfaceSoundAt(-160, -40)).toBe("hard");
    expect(surfaceSoundAt(10_000, 10_000)).toBe("soft");
  });
});
