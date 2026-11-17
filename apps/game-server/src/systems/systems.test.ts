import { describe, expect, it } from "vitest";
import type { ChatBroadcast } from "@entroworld/game-protocol";
import { ChatHistory, isChatBroadcast, sanitizeChatText } from "./chat";
import { StrikeCounter, TokenBucket } from "./RateLimiter";
import { computeVoicePeers } from "./voice";

describe("chat", () => {
  it("strips control, bidi and zero-width characters and collapses whitespace", () => {
    expect(sanitizeChatText("  hi\u0000 there‮​\n\nfriend  ")).toBe("hi there friend");
    expect(sanitizeChatText("​\u0007  ")).toBe("");
    expect(sanitizeChatText("x".repeat(500))).toHaveLength(280);
  });

  it("keeps a bounded, de-duplicated history", () => {
    const h = new ChatHistory(3);
    const msg = (id: string, channel: ChatBroadcast["channel"] = "room"): ChatBroadcast => ({
      id,
      channel,
      from: { userId: "u", username: "u", displayName: "U", sessionId: "s" },
      text: id,
      zoneId: "zone-central",
      ts: 1,
    });
    for (const id of ["a", "b", "b", "c", "d"]) h.push(msg(id));
    expect(h.list().map((m) => m.id)).toEqual(["b", "c", "d"]);
    h.push(msg("e", "global"));
    expect(h.list(["global"]).map((m) => m.id)).toEqual(["e"]);
    expect(isChatBroadcast(msg("x"))).toBe(true);
    expect(isChatBroadcast({ ...msg("x"), from: null })).toBe(false);
  });
});

describe("rate limiting", () => {
  it("token bucket allows a burst then refills over time", () => {
    let now = 0;
    const b = new TokenBucket(3, 1, () => now);
    expect([b.take(), b.take(), b.take(), b.take()]).toEqual([true, true, true, false]);
    now += 1000;
    expect(b.take()).toBe(true);
    expect(b.take()).toBe(false);
  });

  it("strikes expire after the window", () => {
    let now = 0;
    const s = new StrikeCounter(3, 1000, () => now);
    expect(s.add()).toBe(false);
    expect(s.add()).toBe(false);
    now += 1500;
    expect(s.add()).toBe(false);
    expect(s.add()).toBe(false);
    expect(s.add()).toBe(true);
  });
});

describe("proximity voice", () => {
  it("includes only peers within the radius, louder when closer", () => {
    const peers = computeVoicePeers({ userId: "me", x: 0, z: 0 }, [
      { userId: "me", x: 0, z: 0 },
      { userId: "near", x: 2, z: 0 },
      { userId: "mid", x: 0, z: 12 },
      { userId: "far", x: 30, z: 0 },
    ], 22);
    expect(peers.map((p) => p.userId)).toEqual(["near", "mid"]);
    expect(peers[0]!.gain).toBe(1);
    expect(peers[1]!.gain).toBeGreaterThan(0);
    expect(peers[1]!.gain).toBeLessThan(1);
  });
});
