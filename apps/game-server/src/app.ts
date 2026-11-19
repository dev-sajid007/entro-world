import { defineRoom, defineServer, type Presence, type Server } from "@colyseus/core";
import { RedisDriver } from "@colyseus/redis-driver";
import { RedisPresence } from "@colyseus/redis-presence";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { livekitConfigured, type GameEnv } from "@entroworld/config";
import { PhysicsWorld } from "@entroworld/game-engine";
import { ZONE_ROOM } from "@entroworld/game-protocol";
import { ACADEMY_ROOM } from "@entroworld/robot-api";
import { createRoutes } from "./http/routes";
import { createLogger, type Logger } from "./logger";
import { GameMetrics } from "./metrics";
import { AcademyRoom } from "./rooms/AcademyRoom";
import { ZoneRoom } from "./rooms/ZoneRoom";
import { setServices, type GameServices } from "./services";
import { databaseStore, memoryStore, type WorldStore } from "./store";
import { VoiceService } from "./systems/voice";
import { TicketService } from "./tickets";

export interface CreateGameServerOptions {
  logger?: Logger;
  /** Defaults to PostgreSQL when GAME_PERSISTENCE is on, otherwise in-memory. */
  store?: WorldStore;
  /** Install SIGINT/SIGTERM handlers that drain rooms before exiting (default true). */
  handleSignals?: boolean;
}

export async function createServices(env: GameEnv, options: CreateGameServerOptions = {}): Promise<GameServices> {
  const logger = options.logger ?? createLogger(env.LOG_LEVEL, { service: "game-server", serverId: env.GAME_SERVER_ID });
  const voice =
    livekitConfigured(env) && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET && env.LIVEKIT_URL
      ? new VoiceService({
          url: env.LIVEKIT_URL,
          publicUrl: env.LIVEKIT_PUBLIC_URL ?? env.LIVEKIT_URL,
          apiKey: env.LIVEKIT_API_KEY,
          apiSecret: env.LIVEKIT_API_SECRET,
        })
      : null;
  return {
    serverId: env.GAME_SERVER_ID,
    // Characters never collide with each other, so every room in the process shares one static city.
    physics: await PhysicsWorld.create(),
    tickets: new TicketService(env.GAME_TICKET_SECRET),
    replay: null,
    store: options.store ?? (env.GAME_PERSISTENCE ? databaseStore(env.DATABASE_URL) : memoryStore()),
    voice,
    metrics: new GameMetrics(),
    logger,
  };
}

/** Builds (but does not start) the Colyseus server. Call `listen()` on the result. */
export async function createGameServer(env: GameEnv, options: CreateGameServerOptions = {}): Promise<{ server: Server; services: GameServices }> {
  if (env.GAME_DEV_TICKETS && env.NODE_ENV === "production") {
    throw new Error("GAME_DEV_TICKETS must not be enabled in production");
  }
  const svc = await createServices(env, options);
  setServices(svc);
  // Rooms left open by a crashed previous run of this server no longer exist.
  await svc.store.closeServerInstances(svc.serverId).catch((err) => svc.logger.warn("could not reset room instances", { err }));

  // Redis presence + driver let several game-server processes share matchmaking, room discovery
  // and the zone/global chat channels. Without it everything is process-local.
  let presence: Presence | undefined;
  let driver: RedisDriver | undefined;
  if (env.USE_REDIS_PRESENCE) {
    presence = new RedisPresence(env.REDIS_URL);
    driver = new RedisDriver(env.REDIS_URL);
  }

  const server = defineServer({
    rooms: {
      [ZONE_ROOM]: defineRoom(ZoneRoom)
        .filterBy(["zoneId"])
        // Fill the busiest instance first: a social space is better with people in it.
        .sortBy({ clients: -1 }),
      // Pair programming and coding battles: one room per session, found by its id.
      [ACADEMY_ROOM]: defineRoom(AcademyRoom).filterBy(["sessionId"]),
    },
    routes: createRoutes({ devTickets: env.GAME_DEV_TICKETS }),
    transport: new WebSocketTransport({ pingInterval: 5000, pingMaxRetries: 3 }),
    ...(presence ? { presence } : {}),
    ...(driver ? { driver } : {}),
    greet: false,
    gracefullyShutdown: options.handleSignals ?? true,
  });

  server.onBeforeShutdown(() => svc.logger.info("draining rooms before shutdown"));
  server.onShutdown(async () => {
    svc.logger.info("shutdown complete");
    svc.physics.dispose();
    await svc.store.close();
  });
  return { server, services: svc };
}
