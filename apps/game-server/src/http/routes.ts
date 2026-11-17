import { createHash } from "node:crypto";
import { createEndpoint, createRouter, matchMaker } from "@colyseus/core";
import { z } from "zod";
import { DEFAULT_ZONE, LIMITS, USERNAME_PATTERN, ZONE_IDS, type WorldJoinResponse } from "@entroworld/shared";
import { getZoneLayout } from "@entroworld/world-assets";
import { services } from "../services";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const health = createEndpoint("/health", { method: "GET" }, async () => {
  const svc = services();
  const { memory, ...stats } = svc.metrics.snapshot();
  return json({ status: "ok", serverId: svc.serverId, ...stats, heapUsedBytes: memory.heapUsed });
});

/** Ready while the matchmaker accepts rooms; 503 during startup and graceful shutdown (room draining). */
const ready = createEndpoint("/ready", { method: "GET" }, async () => {
  const accepting = matchMaker.state === matchMaker.MatchMakerState.READY;
  return json({ ready: accepting }, accepting ? 200 : 503);
});

const metrics = createEndpoint("/metrics", { method: "GET" }, async () => {
  const svc = services();
  return new Response(svc.metrics.prometheus(svc.serverId), { headers: { "content-type": "text/plain; version=0.0.4" } });
});

const devTicketBody = z
  .object({
    username: z.string().regex(USERNAME_PATTERN).optional(),
    displayName: z.string().trim().min(LIMITS.displayName.min).max(LIMITS.displayName.max).optional(),
    zoneId: z.enum(ZONE_IDS).optional(),
  })
  .strict();

/** Stable fake user id for a dev guest username (RFC 4122 v5 layout), so refreshes keep one identity. */
export function devUserId(username: string): string {
  const h = createHash("sha256").update(`entroworld-dev-guest:${username.toLowerCase()}`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/**
 * Development only: issues a guest ticket so multiplayer can be tested before accounts exist.
 * Production tickets come from the API's `POST /api/v1/worlds/join`.
 */
const devTicket = createEndpoint("/dev/ticket", { method: "POST" }, async (ctx) => {
  const parsed = devTicketBody.safeParse(ctx.body ?? {});
  if (!parsed.success) return json({ error: { code: "invalid_request", message: "Invalid guest ticket request" } }, 400);
  const username = parsed.data.username ?? `guest${Math.floor(10000 + Math.random() * 90000)}`;
  const zoneId = parsed.data.zoneId ?? DEFAULT_ZONE;
  const spawn = getZoneLayout(zoneId).spawn;
  const { ticket, expiresAt } = await services().tickets.sign({
    sub: devUserId(username),
    username,
    displayName: parsed.data.displayName ?? username,
    zoneId,
    spawn: { ...spawn },
    guest: true,
  });
  const body: WorldJoinResponse = { ticket, zoneId, gameServerUrl: "/game", spawn: { ...spawn }, expiresAt: expiresAt.toISOString() };
  return json(body);
});

export function createRoutes(options: { devTickets: boolean }) {
  return createRouter(options.devTickets ? { health, ready, metrics, devTicket } : { health, ready, metrics });
}
