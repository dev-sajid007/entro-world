import { describe, expect, it } from "vitest";
import { DEFAULT_AVATAR, avatarConfigSchema, generateAvatar, sanitizeAvatarConfig } from "./index";

describe("avatar config", () => {
  it("accepts the default avatar", () => {
    expect(avatarConfigSchema.parse(DEFAULT_AVATAR)).toEqual(DEFAULT_AVATAR);
  });

  it("generates valid, deterministic avatars", () => {
    for (const seed of ["alice", "bob", "carol", "dave", "x".repeat(40)]) {
      const a = generateAvatar(seed);
      expect(avatarConfigSchema.safeParse(a).success).toBe(true);
      expect(generateAvatar(seed)).toEqual(a);
    }
  });

  it("rejects unknown catalog items and malformed colors", () => {
    const bad = structuredClone(DEFAULT_AVATAR);
    bad.clothing.top = "spacesuit";
    expect(avatarConfigSchema.safeParse(bad).success).toBe(false);
    const badColor = structuredClone(DEFAULT_AVATAR);
    badColor.clothing.topColor = "red";
    expect(avatarConfigSchema.safeParse(badColor).success).toBe(false);
  });

  it("rejects conflicting accessories and extra keys", () => {
    expect(avatarConfigSchema.safeParse({ ...DEFAULT_AVATAR, accessories: ["cap", "beanie"] }).success).toBe(false);
    expect(avatarConfigSchema.safeParse({ ...DEFAULT_AVATAR, accessories: ["cap", "cap"] }).success).toBe(false);
    expect(avatarConfigSchema.safeParse({ ...DEFAULT_AVATAR, hacked: true }).success).toBe(false);
  });

  it("normalizes color case", () => {
    const upper = structuredClone(DEFAULT_AVATAR);
    upper.clothing.topColor = "#ABCDEF";
    expect(avatarConfigSchema.parse(upper).clothing.topColor).toBe("#abcdef");
  });

  it("sanitizes invalid input to a valid fallback", () => {
    const result = sanitizeAvatarConfig({ nope: 1 }, "seed");
    expect(avatarConfigSchema.safeParse(result).success).toBe(true);
  });
});
