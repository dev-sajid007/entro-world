import { Redis } from "ioredis";
import { aiEnvSchema, loadEnv, resolveAiProvider } from "@entroworld/config";
import { createDatabase } from "@entroworld/database";
import { buildAiApp } from "./app";
import { createProvider } from "./providers";

const env = loadEnv(aiEnvSchema);
const { db, close: closeDb } = createDatabase(env.DATABASE_URL, { applicationName: "entroworld-ai-agent-service" });
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });
await redis.connect();

const provider = createProvider(env);
const app = await buildAiApp(
  { env, db, redis, provider },
  { logger: { level: env.LOG_LEVEL, base: { service: "ai-agent-service" }, redact: ["req.headers.x-entroworld-internal-token"] } },
);
if (resolveAiProvider(env) === "mock") {
  app.log.warn("No AI provider key configured: shopkeepers use the offline mock. Set AI_PROVIDER_API_KEY to use Claude.");
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, "shutting down");
  setTimeout(() => process.exit(1), 10_000).unref();
  try {
    await app.close();
    await Promise.allSettled([closeDb(), redis.quit()]);
  } finally {
    process.exit(0);
  }
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: env.AI_SERVICE_HOST, port: env.AI_SERVICE_PORT });
app.log.info({ provider: provider.name, model: env.AI_DEFAULT_MODEL }, "AI agent service ready");
