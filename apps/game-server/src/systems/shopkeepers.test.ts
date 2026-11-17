import { describe, expect, it } from "vitest";
import { NPC_STATE_TTL_MS, Shopkeepers, type CustomerPosition } from "./shopkeepers";

const AGENT = "9f0e2a52-8c1e-4d5e-a2a5-3f9a1b2c3d4e";
const CONV = "4b8d3c2a-1e0f-4a9b-8c7d-6e5f4a3b2c1d";
const byte = { agentId: AGENT, shopSlug: "code-corner", name: "Byte", avatarSeed: "code-corner-byte" };

function setup() {
  const keepers = new Shopkeepers("zone-market");
  const { added } = keepers.sync([byte]);
  const shop = keepers.shops.find((s) => s.slug === "code-corner")!;
  const at = (sessionId: string, dx = 0, present = true): CustomerPosition => ({ sessionId, x: shop.trigger.x + dx, z: shop.trigger.z, present });
  return { keepers, npc: added[0]!, shop, at };
}

describe("shopkeepers", () => {
  it("places open shops' keepers behind their counters, and only those", () => {
    const { keepers, npc, shop } = setup();
    expect(npc).toMatchObject({ id: "npc:code-corner", name: "Byte", agentId: AGENT, anim: "idle", x: shop.keeper.x, z: shop.keeper.z });
    expect(JSON.parse(npc.avatar).appearance).toBeDefined();
    expect(keepers.sync([byte, { ...byte, shopSlug: "book-cafe" }]).added).toEqual([]);
    expect(new Shopkeepers("zone-central").sync([byte]).added).toEqual([]);
    expect(keepers.sync([])).toEqual({ added: [], removed: ["npc:code-corner"] });
  });

  it("tells a customer when they step up to the counter and when they leave", () => {
    const { keepers, at, shop } = setup();
    expect(keepers.update([at("a", shop.trigger.radius + 3)], 0.1)).toEqual([]);
    expect(keepers.update([at("a")], 0.1)).toEqual([{ sessionId: "a", type: "enter", payload: { shopSlug: "code-corner", agentId: AGENT } }]);
    expect(keepers.update([at("a", 0.5)], 0.1)).toEqual([]);
    expect(keepers.shopOf("a")).toEqual({ shopSlug: "code-corner", agentId: AGENT });
    // Sitting down or disconnecting counts as leaving.
    expect(keepers.update([at("a", 0, false)], 0.1)).toEqual([{ sessionId: "a", type: "leave", payload: { shopSlug: "code-corner", agentId: AGENT } }]);
    expect(keepers.shopOf("a")).toBeNull();
  });

  it("animates talking over thinking over listening over idle", () => {
    const { keepers, npc, at } = setup();
    keepers.update([], 0.1);
    expect(npc.anim).toBe("idle");
    keepers.update([at("a")], 0.1);
    expect(npc.anim).toBe("listening");
    keepers.control({ type: "npc_state", agentId: AGENT, conversationId: CONV, state: "thinking" });
    keepers.update([at("a")], 0.1);
    expect(npc.anim).toBe("thinking");
    const other = "1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d";
    keepers.control({ type: "npc_state", agentId: AGENT, conversationId: other, state: "talking" });
    keepers.update([at("a")], 0.1);
    expect(npc.anim).toBe("talking");
    keepers.control({ type: "npc_state", agentId: AGENT, conversationId: other, state: "idle" });
    keepers.control({ type: "npc_state", agentId: AGENT, conversationId: CONV, state: "idle" });
    keepers.update([], 0.1);
    expect(npc.anim).toBe("idle");
    // Malformed or unrelated messages change nothing.
    keepers.control({ type: "npc_state", agentId: AGENT, conversationId: "nope", state: "talking" });
    keepers.control({ type: "npc_state", agentId: CONV, conversationId: CONV, state: "talking" });
    keepers.update([], 0.1);
    expect(npc.anim).toBe("idle");
  });

  it("forgets a busy state the AI service never ended", () => {
    const { keepers, npc } = setup();
    const t0 = 1_000_000;
    keepers.control({ type: "npc_state", agentId: AGENT, conversationId: CONV, state: "talking" }, t0);
    keepers.update([], 0.1, t0 + 1000);
    expect(npc.anim).toBe("talking");
    keepers.update([], 0.1, t0 + NPC_STATE_TTL_MS + 1);
    expect(npc.anim).toBe("idle");
  });

  it("turns gradually towards the customer and back to the door", () => {
    const { keepers, npc, at, shop } = setup();
    const home = shop.keeper.rotation;
    // A customer standing off to one side of the counter.
    const customer = { ...at("a"), z: shop.trigger.z + 3 };
    for (let i = 0; i < 20; i++) keepers.update([customer], 0.1);
    const turned = npc.rot;
    expect(Math.abs(turned - home)).toBeGreaterThan(0.2);
    // Facing the customer: forward is (-sin, -cos).
    const dx = shop.trigger.x - shop.keeper.x;
    const dz = shop.trigger.z + 3 - shop.keeper.z;
    expect(-Math.sin(turned) * dx + -Math.cos(turned) * dz).toBeGreaterThan(0.99 * Math.hypot(dx, dz));
    keepers.update([], 0.1);
    expect(Math.abs(npc.rot - turned)).toBeLessThanOrEqual(0.4 + 1e-6);
    for (let i = 0; i < 20; i++) keepers.update([], 0.1);
    expect(npc.rot).toBeCloseTo(home, 2);
  });
});
