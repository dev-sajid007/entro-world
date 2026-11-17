import { gameEnvSchema, loadEnv } from "@entroworld/config";
import { createGameServer } from "./app";

const env = loadEnv(gameEnvSchema);
const { server, services } = await createGameServer(env);

await server.listen(env.GAME_PORT, env.GAME_HOST);
services.logger.info("game server listening", {
  host: env.GAME_HOST,
  port: env.GAME_PORT,
  redis: env.USE_REDIS_PRESENCE,
  voice: services.voice !== null,
  devTickets: env.GAME_DEV_TICKETS,
});
