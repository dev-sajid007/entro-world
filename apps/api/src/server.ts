import { Redis } from "ioredis";
import { apiEnvSchema, loadEnv } from "@entroworld/config";
import { createDatabase, runMigrations, seedWorld } from "@entroworld/database";
import { buildApp } from "./app";
import { consoleMailer, type Mailer } from "./lib/mailer";

const env = loadEnv(apiEnvSchema);
if (env.MAIL_TRANSPORT === "smtp") {
  // Fail loudly rather than silently dropping verification emails.
  throw new Error("MAIL_TRANSPORT=smtp is not implemented yet; use MAIL_TRANSPORT=console");
}

const { db, close: closeDb } = createDatabase(env.DATABASE_URL, { applicationName: "entroworld-api" });
const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true });
await redis.connect();

if (env.NODE_ENV !== "production") {
  // Development convenience; production runs `pnpm db:migrate` as a deploy step.
  await runMigrations(db);
  await seedWorld(db);
}

// The console mailer logs through the app's logger, which exists only once the app is built.
let mailer: Mailer | null = null;
const app = await buildApp({ env, db, redis, mailer: { send: (m) => mailer!.send(m) } });
mailer = consoleMailer(app.log);

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
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: env.API_HOST, port: env.API_PORT });
