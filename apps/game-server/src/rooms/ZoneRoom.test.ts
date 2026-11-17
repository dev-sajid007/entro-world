import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { matchMaker } from "@colyseus/core";
import type { Room as ClientRoom } from "@colyseus/sdk";
import { gameEnvSchema } from "@entroworld/config";
import { SIM } from "@entroworld/game-engine";
import {
  AnimCode,
  Buttons,
  ClientMessage,
  CloseReason,
  GAME_TICKET_ISSUER,
  NPC_CONTROL_CHANNEL,
  ServerMessage,
  USER_CONTROL_CHANNEL,
  ZONE_ROOM,
  onlineKey,
  type ChatBroadcast,
  type ErrorPayload,
  type PlayerStateShape,
  type ZoneStateShape,
  type ZoneTransferPayload,
} from "@entroworld/game-protocol";
import type { WorldJoinResponse, ZoneId } from "@entroworld/shared";
import { getCityLayout, getZoneLayout, interactivesInZone } from "@entroworld/world-assets";
import { createGameServer } from "../app";
import { devUserId } from "../http/routes";
import { memoryStore } from "../store";
import type { GameServices } from "../services";
import { TicketService } from "../tickets";
import type { ZoneRoom } from "./ZoneRoom";

const SECRET = "integration-test-secret-0123456789abcdef";
/** Set TEST_REDIS_URL to run the suite with Redis presence + driver (multi-process mode). */
const redisUrl = process.env.TEST_REDIS_URL;
const env = gameEnvSchema.parse({
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  GAME_TICKET_SECRET: SECRET,
  USE_REDIS_PRESENCE: redisUrl ? "true" : "false",
  ...(redisUrl ? { REDIS_URL: redisUrl } : {}),
  GAME_DEV_TICKETS: "true",
  GAME_PERSISTENCE: "false",
});
const store = memoryStore();

let colyseus: ColyseusTestServer;
let svc: GameServices;
let userCounter = 0;
const open: ClientRoom[] = [];

beforeAll(async () => {
  const created = await createGameServer(env, { handleSignals: false, store });
  svc = created.services;
  colyseus = await boot(created.server);
});
afterEach(async () => {
  for (const r of open.splice(0)) await r.leave().catch(() => undefined);
  await colyseus.cleanup();
});
afterAll(async () => {
  await colyseus.shutdown();
});

// -------------------------------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------------------------------

type Spawn = { x: number; y: number; z: number; rotation: number };

function nextUser(name = "player") {
  userCounter++;
  const username = `${name}${userCounter}`;
  return { sub: devUserId(username), username, displayName: `${name} ${userCounter}` };
}

async function apiTicket(zoneId: ZoneId = "zone-central", spawn?: Spawn, user = nextUser()) {
  const { ticket } = await svc.tickets.sign({ ...user, zoneId, spawn: spawn ?? { ...getZoneLayout(zoneId).spawn } }, GAME_TICKET_ISSUER);
  return { ticket, user };
}

async function join(zoneId: ZoneId = "zone-central", spawn?: Spawn, name?: string) {
  const { ticket, user } = await apiTicket(zoneId, spawn, nextUser(name));
  const room = await colyseus.sdk.joinOrCreate(ZONE_ROOM, { zoneId, ticket });
  open.push(room);
  await room.waitForInitialState();
  return { room, user };
}

const state = (room: ClientRoom) => room.state as unknown as ZoneStateShape;
const serverRoom = (room: ClientRoom) => colyseus.getRoomById(room.roomId) as unknown as ZoneRoom & { state: ZoneStateShape };
const serverPlayer = (room: ClientRoom): PlayerStateShape => serverRoom(room).state.players.get(room.sessionId)!;
/** Schema fields are accessors, so `{ ...player }` would copy nothing. */
const position = (p: PlayerStateShape) => ({ x: p.x, y: p.y, z: p.z });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(condition: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error("Timed out waiting for condition");
    await sleep(20);
  }
}

/** Records every message a client receives, by type. */
function inbox(room: ClientRoom) {
  const messages: { type: string; payload: unknown }[] = [];
  room.onMessage("*", (type, payload) => messages.push({ type: String(type), payload }));
  return {
    messages,
    of: <T>(type: string) => messages.filter((m) => m.type === type).map((m) => m.payload as T),
  };
}

/** Streams input like the web client: two fixed steps every ~33 ms, in real time. */
async function walk(room: ClientRoom, buttons: number, seconds: number, startSeq = 1, yaw = 0): Promise<number> {
  let seq = startSeq;
  const sends = Math.round((seconds / SIM.dt) / 2);
  for (let i = 0; i < sends; i++) {
    room.send(ClientMessage.Input, { frames: [{ seq: seq++, buttons, yaw }, { seq: seq++, buttons, yaw }] });
    await sleep(33);
  }
  return seq;
}

/** True when a capsule could stand at (x, z): nothing above floor level around it. */
function clearAt(x: number, z: number): boolean {
  for (const [dx, dz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]] as const) {
    const h = svc.physics.groundHeight(x + dx!, z + dz!, 30);
    if (h === null || h > 0.2) return false;
  }
  return true;
}

function findClearPath(zoneId: ZoneId, fromZ: number, toZ: number, xs: number[]): number {
  for (const x of xs) {
    let ok = true;
    for (let z = Math.min(fromZ, toZ); z <= Math.max(fromZ, toZ) && ok; z += 0.25) ok = clearAt(x, z);
    if (ok) return x;
  }
  throw new Error(`No clear north-south path found in ${zoneId}`);
}

const range = (from: number, to: number, step = 1) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

// -------------------------------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------------------------------

describe("joining", () => {
  it("rejects missing, forged, wrong-zone and reused tickets", async () => {
    await expect(colyseus.sdk.joinOrCreate(ZONE_ROOM, { zoneId: "zone-central" })).rejects.toThrow();

    const forged = await new TicketService("a-different-secret-that-is-long-enough!!").sign({
      ...nextUser(),
      zoneId: "zone-central",
      spawn: { ...getZoneLayout("zone-central").spawn },
    });
    await expect(colyseus.sdk.joinOrCreate(ZONE_ROOM, { zoneId: "zone-central", ticket: forged.ticket })).rejects.toThrow();

    const parkTicket = await apiTicket("zone-park");
    await expect(colyseus.sdk.joinOrCreate(ZONE_ROOM, { zoneId: "zone-central", ticket: parkTicket.ticket })).rejects.toThrow();

    const { ticket } = await apiTicket("zone-central");
    const first = await colyseus.sdk.joinOrCreate(ZONE_ROOM, { zoneId: "zone-central", ticket });
    open.push(first);
    await expect(colyseus.sdk.joinOrCreate(ZONE_ROOM, { zoneId: "zone-central", ticket })).rejects.toThrow();
  });

  it("puts players of the same zone in one room where they see each other", async () => {
    const a = await join("zone-central", undefined, "alice");
    const b = await join("zone-central", undefined, "bob");
    expect(b.room.roomId).toBe(a.room.roomId);

    await until(() => state(a.room).players.size === 2 && state(b.room).players.size === 2);
    const bobSeenByAlice = state(a.room).players.get(b.room.sessionId)!;
    expect(bobSeenByAlice.displayName).toBe(b.user.displayName);
    expect(JSON.parse(bobSeenByAlice.avatar).modelId).toBe("humanoid-v1");

    // Other zones get their own rooms.
    const c = await join("zone-park");
    expect(c.room.roomId).not.toBe(a.room.roomId);
    expect(state(c.room).players.size).toBe(1);
  });

  it("falls back to the zone spawn when a ticket's spawn is implausible", async () => {
    const { room } = await join("zone-central", { x: 5000, y: 0, z: 5000, rotation: 0 });
    const spawn = getZoneLayout("zone-central").spawn;
    expect(Math.hypot(serverPlayer(room).x - spawn.x, serverPlayer(room).z - spawn.z)).toBeLessThan(1);
  });

  it("replaces an older session of the same account", async () => {
    const user = nextUser("twin");
    const spawn = { ...getZoneLayout("zone-central").spawn };
    const first = await colyseus.sdk.joinOrCreate(ZONE_ROOM, { zoneId: "zone-central", ticket: (await svc.tickets.sign({ ...user, zoneId: "zone-central", spawn })).ticket });
    open.push(first);
    await first.waitForInitialState();
    let closeCode = 0;
    first.onLeave((code) => (closeCode = code));
    const second = await colyseus.sdk.joinOrCreate(ZONE_ROOM, { zoneId: "zone-central", ticket: (await svc.tickets.sign({ ...user, zoneId: "zone-central", spawn })).ticket });
    open.push(second);
    await until(() => closeCode !== 0);
    expect(closeCode).toBe(CloseReason.DuplicateSession);
    expect(serverRoom(second).state.players.size).toBe(1);
  });
});

describe("authoritative movement", () => {
  it("moves players from their inputs and synchronizes the result", async () => {
    const a = await join();
    const b = await join();
    await sleep(400);
    const start = position(serverPlayer(a.room));
    const lastSeq = (await walk(a.room, Buttons.Forward, 0.5)) - 1;

    await until(() => serverPlayer(a.room).seq === lastSeq);
    const end = serverPlayer(a.room);
    // Forward at yaw 0 walks towards -Z at walking speed.
    expect(start.z - end.z).toBeGreaterThan(SIM.walkSpeed * 0.5 * 0.8);
    expect(start.z - end.z).toBeLessThan(SIM.walkSpeed * 0.5 * 1.2);

    // The other client receives the new position.
    await until(() => Math.abs(state(b.room).players.get(a.room.sessionId)!.z - end.z) < 0.01);
    // And the mover gets its own acknowledged sequence for reconciliation.
    await until(() => state(a.room).players.get(a.room.sessionId)!.seq === lastSeq);
  });

  it("ignores input floods: nobody moves faster than real time", async () => {
    const { room } = await join();
    await sleep(400);
    const start = position(serverPlayer(room));
    const rejectedBefore = svc.metrics.snapshot().counters.rejectedInputs;

    // Ten messages of 12 sprint frames: two seconds of input delivered instantly.
    let seq = 1;
    for (let m = 0; m < 10; m++) {
      room.send(ClientMessage.Input, { frames: Array.from({ length: 12 }, () => ({ seq: seq++, buttons: Buttons.Forward | Buttons.Sprint, yaw: 0 })) });
    }
    await sleep(1200);
    const end = serverPlayer(room);
    const moved = Math.hypot(end.x - start.x, end.z - start.z);
    // At most the 0.5 s input queue could be simulated (an honest 2 s sprint would cover ~17 m).
    expect(moved).toBeLessThan(SIM.runSpeed * 0.5 + 0.5);
    expect(svc.metrics.snapshot().counters.rejectedInputs).toBeGreaterThan(rejectedBefore);
  });

  it("rejects malformed input and disconnects persistent abusers", async () => {
    const { room } = await join();
    const server = serverRoom(room);
    const box = inbox(room);
    room.send(ClientMessage.Input, { frames: [{ seq: 1, buttons: 999, yaw: 0 }] });
    room.send(ClientMessage.Input, { frames: [{ seq: 2, buttons: 1, yaw: Number.NaN }] });
    room.send("teleport", { x: 0, y: 100, z: 0 });
    await until(() => box.of<ErrorPayload>(ServerMessage.Error).length >= 3);
    expect(box.of<ErrorPayload>(ServerMessage.Error).map((e) => e.code)).toEqual(["invalid_message", "invalid_message", "unknown_message"]);

    let closeCode = 0;
    room.onLeave((code) => (closeCode = code));
    room.reconnection.maxRetries = 0;
    for (let i = 0; i < 25; i++) room.send(ClientMessage.Emote, { emote: "moonwalk" });
    await until(() => closeCode !== 0);
    expect(closeCode).toBe(CloseReason.Kicked);
    // Gone for good, not held open for reconnection.
    await until(() => server.state.players.size === 0);
  });

  it("keeps the player through a dropped connection", async () => {
    const { room } = await join();
    await sleep(200);
    const sessionId = room.sessionId;
    const before = position(serverPlayer(room));
    let reconnected = false;
    // The SDK only auto-reconnects rooms that have been up for a while (5 s by default).
    room.reconnection.minUptime = 0;
    room.onReconnect(() => (reconnected = true));
    (room as unknown as { connection: { close(): void } }).connection.close();
    await until(() => reconnected, 8000);
    expect(room.sessionId).toBe(sessionId);
    const after = serverRoom(room).state.players.get(sessionId)!;
    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.01);
  });
});

describe("interest management", () => {
  it("only synchronizes players within view range", async () => {
    const spawn = getZoneLayout("zone-central").spawn;
    const near = await join("zone-central", { ...spawn, x: spawn.x + 4 });
    const far = await join("zone-central", { x: spawn.x, y: 0, z: -165, rotation: 0 });
    const viewer = await join("zone-central", { ...spawn });
    await sleep(500);
    expect(serverRoom(viewer.room).state.players.size).toBe(3);
    const visible = [...state(viewer.room).players.keys()];
    expect(visible).toContain(near.room.sessionId);
    expect(visible).toContain(viewer.room.sessionId);
    expect(visible).not.toContain(far.room.sessionId);
  });
});

describe("chat", () => {
  it("delivers room chat to the room and zone chat to every room of the zone", async () => {
    const a = await join();
    const b = await join();
    const boxB = inbox(b.room);

    // A second instance of the same zone (e.g. the first one filled up).
    const other = await matchMaker.createRoom(ZONE_ROOM, { zoneId: "zone-central" });
    const { ticket } = await apiTicket("zone-central");
    const c = await colyseus.sdk.joinById(other.roomId, { zoneId: "zone-central", ticket });
    open.push(c);
    const boxC = inbox(c);

    a.room.send(ClientMessage.Chat, { channel: "room", text: "  hello​ room " });
    a.room.send(ClientMessage.Chat, { channel: "zone", text: "hello zone" });
    await until(() => boxB.of<ChatBroadcast>(ServerMessage.Chat).length === 2 && boxC.of<ChatBroadcast>(ServerMessage.Chat).length === 1);
    expect(boxB.of<ChatBroadcast>(ServerMessage.Chat).map((m) => m.text)).toEqual(["hello room", "hello zone"]);
    const zoneMsg = boxC.of<ChatBroadcast>(ServerMessage.Chat)[0]!;
    expect(zoneMsg).toMatchObject({ channel: "zone", text: "hello zone", from: { userId: a.user.sub, displayName: a.user.displayName } });

    // Late joiners receive recent history.
    const { ticket: t2 } = await apiTicket("zone-central");
    const late = await colyseus.sdk.joinById(a.room.roomId, { zoneId: "zone-central", ticket: t2 });
    open.push(late);
    const history = await late.waitForMessage(ServerMessage.ChatHistory);
    expect((history as ChatBroadcast[]).map((m) => m.text)).toEqual(["hello room", "hello zone"]);
  });

  it("rate limits chat", async () => {
    const { room } = await join();
    const box = inbox(room);
    for (let i = 0; i < 8; i++) room.send(ClientMessage.Chat, { channel: "room", text: `spam ${i}` });
    await until(() => box.of<ErrorPayload>(ServerMessage.Error).length >= 3);
    expect(box.of<ChatBroadcast>(ServerMessage.Chat).length).toBe(5);
    expect(box.of<ErrorPayload>(ServerMessage.Error)[0]!.code).toBe("rate_limited");
  });
});

describe("interactions", () => {
  const seat = interactivesInZone("zone-central").find((o) => o.kind === "seat")!;
  const nearSeat = { x: seat.x - Math.sin(seat.rotation) * 1.2, y: 0, z: seat.z - Math.cos(seat.rotation) * 1.2, rotation: seat.rotation };

  it("lets one player at a time sit on a seat and stand up again", async () => {
    const a = await join("zone-central", nearSeat);
    const b = await join("zone-central", nearSeat);
    const boxB = inbox(b.room);
    await sleep(300);

    a.room.send(ClientMessage.Interact, { objectId: seat.id });
    await until(() => serverPlayer(a.room).seatId === seat.id);
    expect(serverPlayer(a.room).anim).toBe(AnimCode.SITTING);
    expect(serverRoom(a.room).state.objects.get(seat.id)!.occupant).toBe(a.room.sessionId);
    await until(() => state(b.room).objects.get(seat.id)?.occupant === a.room.sessionId);

    b.room.send(ClientMessage.Interact, { objectId: seat.id });
    await until(() => boxB.of<ErrorPayload>(ServerMessage.Error).length === 1);
    expect(boxB.of<ErrorPayload>(ServerMessage.Error)[0]!.code).toBe("seat_taken");

    a.room.send(ClientMessage.Stand, {});
    await until(() => serverPlayer(a.room).seatId === "");
    expect(serverRoom(a.room).state.objects.get(seat.id)!.occupant).toBe("");
  });

  it("refuses interactions out of reach", async () => {
    const { room } = await join();
    const box = inbox(room);
    room.send(ClientMessage.Interact, { objectId: seat.id });
    room.send(ClientMessage.Interact, { objectId: "seat:does-not-exist" });
    await until(() => box.of<ErrorPayload>(ServerMessage.Error).length === 2);
    expect(box.of<ErrorPayload>(ServerMessage.Error).map((e) => e.code)).toEqual(["too_far", "unknown_object"]);
    expect(serverPlayer(room).seatId).toBe("");
  });
});

describe("zones", () => {
  it("transfers a player who walks across a zone border", async () => {
    // Central Plaza (z < 0) borders the City Park (z > 0).
    const x = findClearPath("zone-central", -7, 7, range(-70, 70, 2));
    const { room, user } = await join("zone-central", { x, y: 0, z: -6, rotation: 0 });
    const box = inbox(room);
    await sleep(300);
    // Backward at yaw 0 walks towards +Z.
    await walk(room, Buttons.Backward | Buttons.Sprint, 1.6);
    await until(() => box.of<ZoneTransferPayload>(ServerMessage.ZoneTransfer).length === 1);
    const transfer = box.of<ZoneTransferPayload>(ServerMessage.ZoneTransfer)[0]!;
    expect(transfer).toMatchObject({ zoneId: "zone-park", reason: "border" });
    expect(transfer.position.z).toBeGreaterThan(4);

    const claims = await svc.tickets.verify(transfer.ticket);
    expect(claims).toMatchObject({ sub: user.sub, zoneId: "zone-park" });
    await room.leave();
    const park = await colyseus.sdk.joinOrCreate(ZONE_ROOM, { zoneId: "zone-park", ticket: transfer.ticket });
    open.push(park);
    await park.waitForInitialState();
    const p = serverPlayer(park);
    expect(Math.hypot(p.x - transfer.position.x, p.z - transfer.position.z)).toBeLessThan(0.5);
  });

  it("fast-travels through a transit kiosk", async () => {
    const kiosk = interactivesInZone("zone-central").find((o) => o.kind === "kiosk")!;
    const { room } = await join("zone-central", { x: kiosk.x + 1, y: 0, z: kiosk.z + 1, rotation: 0 });
    const box = inbox(room);
    await sleep(200);
    room.send(ClientMessage.Travel, { kioskId: kiosk.id, zoneId: "zone-beach" });
    await until(() => box.of<ZoneTransferPayload>(ServerMessage.ZoneTransfer).length === 1);
    const transfer = box.of<ZoneTransferPayload>(ServerMessage.ZoneTransfer)[0]!;
    expect(transfer).toMatchObject({ zoneId: "zone-beach", reason: "travel", position: getZoneLayout("zone-beach").spawn });
  });
});

describe("http", () => {
  it("serves health, readiness and Prometheus metrics", async () => {
    const health = await colyseus.http.get("/health");
    expect(health.statusCode).toBe(200);
    expect(health.data).toMatchObject({ status: "ok", serverId: env.GAME_SERVER_ID });
    const ready = await colyseus.http.get("/ready");
    expect(ready.data).toEqual({ ready: true });
    const metrics = await colyseus.http.get("/metrics");
    expect(String(metrics.data)).toContain("entroworld_game_tick_duration_ms");
  });

  it("issues dev guest tickets that can join the world", async () => {
    const res = await colyseus.http.post("/dev/ticket", {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "guestTester", displayName: "Guest Tester", zoneId: "zone-park" }),
    });
    const body = res.data as WorldJoinResponse;
    expect(body).toMatchObject({ zoneId: "zone-park", gameServerUrl: "/game" });
    const room = await colyseus.sdk.joinOrCreate(ZONE_ROOM, { zoneId: "zone-park", ticket: body.ticket });
    open.push(room);
    await room.waitForInitialState();
    expect(serverPlayer(room)).toMatchObject({ username: "guestTester", displayName: "Guest Tester", userId: devUserId("guestTester") });

    const bad = await colyseus.http
      .post("/dev/ticket", { headers: { "content-type": "application/json" }, body: JSON.stringify({ zoneId: "zone-moon" }) })
      .catch((e: { statusCode: number }) => e);
    expect(bad.statusCode).toBe(400);
  });
});

describe("persistence and presence", () => {
  it("saves an account's position when they leave, but never a guest's", async () => {
    const { room, user } = await join("zone-central");
    const start = position(serverPlayer(room));
    await walk(room, Buttons.Forward, 0.5);
    await until(() => Math.hypot(serverPlayer(room).x - start.x, serverPlayer(room).z - start.z) > 1);
    // Buffered input can still be applied after the last send: wait until the player stands still.
    let last = position(serverPlayer(room));
    for (let settled = 0; settled < 3; ) {
      await sleep(50);
      const now = position(serverPlayer(room));
      settled = now.x === last.x && now.z === last.z ? settled + 1 : 0;
      last = now;
    }
    await room.leave();
    await until(() => store.positions.has(user.sub));
    const saved = store.positions.get(user.sub)!;
    expect(saved.zoneId).toBe("zone-central");
    expect(saved.x).toBeCloseTo(last.x, 1);
    expect(saved.z).toBeCloseTo(last.z, 1);

    const res = await colyseus.http.post("/dev/ticket", { headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "nobodySaved" }) });
    const guest = await colyseus.sdk.joinOrCreate(ZONE_ROOM, { zoneId: "zone-central", ticket: (res.data as WorldJoinResponse).ticket });
    await guest.waitForInitialState();
    expect(await matchMaker.presence.get(onlineKey(devUserId("nobodySaved")))).toBeFalsy();
    await guest.leave();
    await sleep(100);
    expect(store.positions.has(devUserId("nobodySaved"))).toBe(false);
  });

  it("publishes online presence for friends and clears it on leave", async () => {
    const { room, user } = await join("zone-park");
    expect(await matchMaker.presence.get(onlineKey(user.sub))).toBe("zone-park");
    await room.leave();
    const deadline = Date.now() + 2000;
    while ((await matchMaker.presence.get(onlineKey(user.sub))) && Date.now() < deadline) await sleep(20);
    expect(await matchMaker.presence.get(onlineKey(user.sub))).toBeFalsy();
  });

  it("records room instances with player counts and closes them on dispose", async () => {
    const { room } = await join("zone-beach");
    const roomId = room.roomId;
    expect(store.instances.get(roomId)).toMatchObject({ zoneId: "zone-beach", status: "open", serverId: env.GAME_SERVER_ID });
    await until(() => store.instances.get(roomId)?.currentPlayers === 1, 7000);
    await room.leave();
    await until(() => store.instances.get(roomId)?.status === "closed");
    expect(store.instances.get(roomId)?.currentPlayers).toBe(0);
  }, 15_000);

  it("disconnects a user when the API asks (sign-out, leave)", async () => {
    const { room, user } = await join("zone-central");
    const bystander = await join("zone-central");
    let closeCode = 0;
    room.onLeave((code) => (closeCode = code));
    await matchMaker.presence.publish(USER_CONTROL_CHANNEL, { type: "disconnect", userId: user.sub, reason: "left" });
    await until(() => closeCode !== 0);
    expect(closeCode).toBe(CloseReason.SignedOut);
    await until(() => serverRoom(bystander.room).state.players.size === 1);
    // Garbage on the channel is ignored.
    await matchMaker.presence.publish(USER_CONTROL_CHANNEL, { type: "explode", userId: "x" });
    await sleep(50);
    expect(serverRoom(bystander.room).state.players.size).toBe(1);
  });

  it("reloads an avatar changed outside the game", async () => {
    const { room, user } = await join("zone-central");
    const before = JSON.parse(serverPlayer(room).avatar);
    const bodyType = before.appearance.bodyType === "slim" ? "broad" : "slim";
    store.avatars.set(user.sub, { ...before, appearance: { ...before.appearance, bodyType } });
    await matchMaker.presence.publish(USER_CONTROL_CHANNEL, { type: "avatar_changed", userId: user.sub });
    await until(() => JSON.parse(state(room).players.get(room.sessionId)!.avatar).appearance.bodyType === bodyType);
  });
});

describe("AI shopkeepers", () => {
  const agentId = "2c4e6a8b-0d1f-4a3b-9c5d-7e9f1a3b5c7d";
  const conversationId = "8a6c4e2b-0f1d-4b3a-8c5e-7d9f1b3a5c7e";

  it("shows the shopkeeper, greets customers at the counter and animates from the AI service", async () => {
    store.shops.set("code-corner", { agentId, shopSlug: "code-corner", name: "Byte", avatarSeed: "code-corner-byte" });
    try {
      const shop = getCityLayout().shops.find((s) => s.slug === "code-corner")!;
      const ticket = await apiTicket("zone-market", { x: shop.trigger.x, y: 0, z: shop.trigger.z, rotation: Math.PI / 2 });
      const room = await colyseus.sdk.joinOrCreate(ZONE_ROOM, { zoneId: "zone-market", ticket: ticket.ticket });
      open.push(room);
      const box = inbox(room);
      await room.waitForInitialState();
      const npc = () => state(room).npcs.get("npc:code-corner");
      await until(() => npc() !== undefined);
      expect(npc()).toMatchObject({ name: "Byte", agentId, shopSlug: "code-corner" });
      await until(() => box.of(ServerMessage.ShopEnter).length === 1);
      expect(box.of(ServerMessage.ShopEnter)[0]).toEqual({ shopSlug: "code-corner", agentId });
      await until(() => npc()!.anim === "listening");

      await matchMaker.presence.publish(NPC_CONTROL_CHANNEL, { type: "npc_state", agentId, conversationId, state: "thinking" });
      await until(() => npc()!.anim === "thinking");
      await matchMaker.presence.publish(NPC_CONTROL_CHANNEL, { type: "npc_state", agentId, conversationId, state: "talking" });
      await until(() => npc()!.anim === "talking");
      await matchMaker.presence.publish(NPC_CONTROL_CHANNEL, { type: "npc_state", agentId, conversationId, state: "idle" });
      await until(() => npc()!.anim === "listening");
    } finally {
      store.shops.clear();
    }
  });

  it("has no shopkeepers in other zones", async () => {
    const { room } = await join("zone-central");
    expect(state(room).npcs.size).toBe(0);
  });
});
