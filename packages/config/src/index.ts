import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", "yes", "no"])
  .transform((v) => v === "true" || v === "1" || v === "yes");

const secret = (name: string) =>
  z
    .string({ error: `${name} is required (run "pnpm setup" to generate a local .env)` })
    .min(32, `${name} must be at least 32 characters`);

const common = {
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().url().default("postgres://entroworld:entroworld@127.0.0.1:5432/entroworld"),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  GAME_TICKET_SECRET: secret("GAME_TICKET_SECRET"),
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_PUBLIC_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
};

export const apiEnvSchema = z.object({
  ...common,
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  APP_URL: z.string().url().default("http://localhost:5173"),
  CORS_ORIGINS: z
    .string()
    .default("http://localhost:5173")
    .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
  TRUST_PROXY: bool.default(false),
  JWT_ACCESS_SECRET: secret("JWT_ACCESS_SECRET"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: bool.default(false),
  GAME_SERVER_PUBLIC_URL: z.string().default("/game"),
  S3_ENDPOINT: z.string().url().default("http://127.0.0.1:9000"),
  S3_PUBLIC_URL: z.string().url().default("http://127.0.0.1:9000"),
  S3_REGION: z.string().default("us-east-1"),
  S3_BUCKET: z.string().default("entroworld-media"),
  S3_ACCESS_KEY: z.string().default(""),
  S3_SECRET_KEY: z.string().default(""),
  S3_FORCE_PATH_STYLE: bool.default(true),
  MAIL_TRANSPORT: z.enum(["console", "smtp"]).default("console"),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("EntroWorld <no-reply@entroworld.local>"),
  REQUIRE_EMAIL_VERIFICATION: bool.default(false),
});
export type ApiEnv = z.infer<typeof apiEnvSchema>;

export const gameEnvSchema = z.object({
  ...common,
  GAME_HOST: z.string().default("127.0.0.1"),
  GAME_PORT: z.coerce.number().int().positive().default(2567),
  /** Public identifier of this game server process (used for world instance bookkeeping). */
  GAME_SERVER_ID: z.string().default("game-1"),
  USE_REDIS_PRESENCE: bool.default(true),
  /** Load avatars and save positions/instances in PostgreSQL. Disable to run without a database. */
  GAME_PERSISTENCE: bool.default(true),
  /**
   * Development only: exposes POST /dev/ticket, which issues guest room tickets without the API.
   * Used to test multiplayer before accounts exist. Refused when NODE_ENV=production.
   */
  GAME_DEV_TICKETS: bool.default(false),
});
export type GameEnv = z.infer<typeof gameEnvSchema>;

export const workerEnvSchema = apiEnvSchema;
export type WorkerEnv = ApiEnv;

/** Parses environment variables, printing a readable report and exiting on failure. */
export function loadEnv<S extends z.ZodType>(schema: S, source: Record<string, string | undefined> = process.env): z.infer<S> {
  const cleaned: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) if (v !== undefined && v !== "") cleaned[k] = v;
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${lines.join("\n")}`);
  }
  return result.data;
}

export function livekitConfigured(env: { LIVEKIT_URL?: string | undefined; LIVEKIT_API_KEY?: string | undefined; LIVEKIT_API_SECRET?: string | undefined }): boolean {
  return Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);
}
