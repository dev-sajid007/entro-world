import { describe, expect, it } from "vitest";
import { SignJWT } from "jose";
import { LocalPresence } from "@colyseus/core";
import { GAME_TICKET_AUDIENCE, GAME_TICKET_ISSUER } from "@entroworld/game-protocol";
import { TicketError, TicketService, presenceReplayGuard } from "./tickets";

const SECRET = "test-secret-that-is-long-enough-0123456789";
const claims = {
  sub: "6f1c2b9e-3d4a-4f5b-8c6d-7e8f9a0b1c2d",
  username: "alice",
  displayName: "Alice",
  zoneId: "zone-central" as const,
  spawn: { x: 1, y: 0, z: -50, rotation: 0 },
};

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof TicketError ? e.code : "other";
  }
};

describe("TicketService", () => {
  const tickets = new TicketService(SECRET);

  it("round-trips API-issued and server-issued tickets", async () => {
    for (const issuer of [GAME_TICKET_ISSUER, undefined]) {
      const { ticket } = await tickets.sign(claims, issuer);
      const verified = await tickets.verify(ticket);
      expect(verified).toMatchObject(claims);
      expect(verified.jti.length).toBeGreaterThanOrEqual(8);
    }
  });

  it("rejects missing, forged, expired and foreign-audience tickets", async () => {
    expect(await code(tickets.verify(undefined))).toBe("ticket_missing");
    const { ticket } = await new TicketService("another-secret-that-is-long-enough-xyz").sign(claims);
    expect(await code(tickets.verify(ticket))).toBe("ticket_invalid");

    const key = new TextEncoder().encode(SECRET);
    const base = () =>
      new SignJWT({ username: "alice", displayName: "Alice", zoneId: "zone-central", spawn: claims.spawn })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(claims.sub)
        .setJti("abcdefgh12")
        .setIssuer(GAME_TICKET_ISSUER);
    const expired = await base().setAudience(GAME_TICKET_AUDIENCE).setExpirationTime(Math.floor(Date.now() / 1000) - 60).sign(key);
    expect(await code(tickets.verify(expired))).toBe("ticket_expired");
    const wrongAudience = await base().setAudience("entroworld:api").setExpirationTime("1m").sign(key);
    expect(await code(tickets.verify(wrongAudience))).toBe("ticket_invalid");
    const badZone = await new SignJWT({ username: "a", displayName: "A", zoneId: "zone-moon", spawn: claims.spawn })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(claims.sub)
      .setJti("abcdefgh12")
      .setIssuer(GAME_TICKET_ISSUER)
      .setAudience(GAME_TICKET_AUDIENCE)
      .setExpirationTime("1m")
      .sign(key);
    expect(await code(tickets.verify(badZone))).toBe("ticket_invalid");
  });

  it("accepts each ticket id only once", async () => {
    const presence = new LocalPresence();
    const guard = presenceReplayGuard(presence);
    expect(await guard.claim("ticket-1")).toBe(true);
    expect(await guard.claim("ticket-1")).toBe(false);
    expect(await guard.claim("ticket-2")).toBe(true);
    presence.shutdown();
  });
});
