import { jwtVerify } from "jose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { saveWorldStates, upsertWorldInstance, worldZones } from "@entroworld/database";
import { GAME_TICKET_AUDIENCE, USER_CONTROL_CHANNEL, gameTicketClaimsSchema } from "@entroworld/game-protocol";
import { getZoneLayout } from "@entroworld/world-assets";
import { ZONE_IDS } from "@entroworld/shared";
import { eq } from "drizzle-orm";
import { call, createHarness, register, type Harness } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.db.update(worldZones).set({ isActive: true });
  await h.close();
});
beforeEach(() => h.reset());

const verifyTicket = async (ticket: string) => {
  const { payload } = await jwtVerify(ticket, new TextEncoder().encode(h.env.GAME_TICKET_SECRET), { audience: GAME_TICKET_AUDIENCE });
  return gameTicketClaimsSchema.parse(payload);
};

describe("worlds", () => {
  it("lists the world with its zones and live player counts", async () => {
    const u = await register(h);
    await upsertWorldInstance(h.db, { roomId: "room-a", zoneId: "zone-park", serverId: "game-1", currentPlayers: 7, status: "open" });
    await upsertWorldInstance(h.db, { roomId: "room-b", zoneId: "zone-park", serverId: "game-1", currentPlayers: 3, status: "open" });
    await upsertWorldInstance(h.db, { roomId: "room-c", zoneId: "zone-park", serverId: "game-1", currentPlayers: 50, status: "closed" });
    const res = await call(h, "GET", "/worlds", { as: u });
    expect(res.statusCode).toBe(200);
    expect(res.data).toHaveLength(1);
    expect(res.data[0].zones).toHaveLength(ZONE_IDS.length);
    expect(res.data[0].zones.find((z: { id: string }) => z.id === "zone-park").onlinePlayers).toBe(10);
    expect((await call(h, "GET", `/worlds/${res.data[0].id}/zones`, { as: u })).data).toHaveLength(ZONE_IDS.length);
    expect((await call(h, "GET", "/worlds/zones/zone-beach", { as: u })).data.name).toBe("Waterfront");
    expect((await call(h, "GET", "/worlds/zones/zone-moon", { as: u })).statusCode).toBe(400);
    expect((await call(h, "GET", "/worlds"))).toMatchObject({ statusCode: 401 });
  });

  it("issues a game ticket for the default zone spawn", async () => {
    const u = await register(h, "traveller");
    const res = await call(h, "POST", "/worlds/join", { as: u, body: {} });
    expect(res.statusCode).toBe(200);
    expect(res.data).toMatchObject({ zoneId: "zone-central", gameServerUrl: "/game", spawn: getZoneLayout("zone-central").spawn });
    const claims = await verifyTicket(res.data.ticket);
    expect(claims).toMatchObject({ sub: u.user.id, username: "traveller", displayName: "TRAVELLER", zoneId: "zone-central" });
  });

  it("returns players to their saved position, or a requested zone's spawn", async () => {
    const u = await register(h);
    await saveWorldStates(h.db, [{ userId: u.user.id, zoneId: "zone-beach", x: 101.5, y: 0, z: 40.25, rotation: 1.5 }]);
    const back = await call(h, "POST", "/worlds/join", { as: u, body: {} });
    expect(back.data).toMatchObject({ zoneId: "zone-beach", spawn: { x: 101.5, y: 0, z: 40.25, rotation: 1.5 } });
    const elsewhere = await call(h, "POST", "/worlds/join", { as: u, body: { zoneId: "zone-park" } });
    expect(elsewhere.data).toMatchObject({ zoneId: "zone-park", spawn: getZoneLayout("zone-park").spawn });
  });

  it("refuses closed zones and suspended accounts", async () => {
    const u = await register(h);
    await h.db.update(worldZones).set({ isActive: false }).where(eq(worldZones.slug, "zone-event"));
    const closed = await call(h, "POST", "/worlds/join", { as: u, body: { zoneId: "zone-event" } });
    expect(closed.data.error.code).toBe("zone_closed");
    await h.db.update(worldZones).set({ isActive: true });
    await h.db.execute(`update users set status = 'suspended' where id = '${u.user.id}'`);
    expect((await call(h, "POST", "/worlds/join", { as: u, body: {} })).statusCode).toBe(403);
  });

  it("leave tells the game servers to disconnect the user", async () => {
    const u = await register(h);
    const sub = h.redis.duplicate();
    const received = new Promise<string>((resolve) => sub.on("message", (_channel, message) => resolve(message)));
    await sub.subscribe(USER_CONTROL_CHANNEL);
    try {
      expect((await call(h, "POST", "/worlds/leave", { as: u })).statusCode).toBe(204);
      expect(JSON.parse(await received)).toEqual({ type: "disconnect", userId: u.user.id, reason: "left" });
    } finally {
      sub.disconnect();
    }
  });

  it("restricts the instance list to moderators", async () => {
    const u = await register(h);
    expect((await call(h, "GET", "/worlds/instances", { as: u })).statusCode).toBe(403);
  });
});

describe("api basics", () => {
  it("answers health and readiness probes", async () => {
    expect((await h.app.inject({ url: "/health" })).statusCode).toBe(200);
    expect(JSON.parse((await h.app.inject({ url: "/ready" })).body)).toEqual({ status: "ready" });
  });

  it("returns the standard error body for unknown routes and malformed JSON", async () => {
    const missing = await call(h, "GET", "/nope");
    expect(missing.statusCode).toBe(404);
    expect(missing.data.error.code).toBe("not_found");
    const bad = await h.app.inject({ method: "POST", url: "/api/v1/auth/login", headers: { "content-type": "application/json" }, payload: "{oops" });
    expect(bad.statusCode).toBe(400);
    expect(JSON.parse(bad.body).error.code).toBe("invalid_json");
  });

  it("sets defensive headers and allows only configured CORS origins", async () => {
    const ok = await h.app.inject({ method: "OPTIONS", url: "/api/v1/auth/login", headers: { origin: "http://localhost:5173", "access-control-request-method": "POST" } });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    const evil = await h.app.inject({ method: "OPTIONS", url: "/api/v1/auth/login", headers: { origin: "https://evil.example", "access-control-request-method": "POST" } });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
    const res = await h.app.inject({ url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
