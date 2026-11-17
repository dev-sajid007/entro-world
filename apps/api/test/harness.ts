import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { Redis } from "ioredis";
import { sql } from "drizzle-orm";
import { apiEnvSchema, loadEnv, type ApiEnv } from "@entroworld/config";
import { createDatabase, type DatabaseConnection } from "@entroworld/database";
import type { AuthTokenResponse } from "@entroworld/shared";
import { API_PREFIX, buildApp } from "../src/app";
import { memoryMailer } from "../src/lib/mailer";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://entroworld:entroworld@127.0.0.1:5432/entroworld_test";
/** A dedicated logical database so tests never touch development data. */
const TEST_REDIS_URL = process.env.TEST_API_REDIS_URL ?? "redis://127.0.0.1:6379/14";

export const TEST_PASSWORD = "correct horse battery";

export interface Harness {
  app: FastifyInstance;
  env: ApiEnv;
  db: DatabaseConnection["db"];
  redis: Redis;
  mail: ReturnType<typeof memoryMailer>;
  /** Clears all user data (zones stay seeded) and Redis. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(overrides: Record<string, string> = {}, options: { rateLimit?: boolean } = {}): Promise<Harness> {
  const env = loadEnv(apiEnvSchema, {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    JWT_ACCESS_SECRET: "test-access-secret-0123456789abcdef0123456789",
    GAME_TICKET_SECRET: "test-ticket-secret-0123456789abcdef0123456789",
    APP_URL: "http://localhost:5173",
    ...overrides,
  });
  const connection = createDatabase(env.DATABASE_URL, { max: 4 });
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  const mail = memoryMailer();
  const app = await buildApp({ env, db: connection.db, redis, mailer: mail }, { logger: false, rateLimit: options.rateLimit ?? false });
  await app.ready();
  return {
    app,
    env,
    db: connection.db,
    redis,
    mail,
    async reset() {
      await connection.db.execute(sql`truncate users, user_world_state, world_instances restart identity cascade`);
      await redis.flushdb();
      mail.outbox.length = 0;
    },
    async close() {
      await app.close();
      await connection.close();
      redis.disconnect();
    },
  };
}

export interface TestUser extends AuthTokenResponse {
  cookie: string;
  password: string;
}

/** Calls the API; `as` authenticates with a user's access token. */
export async function call(
  h: Harness,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  options: { as?: { accessToken: string }; body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<LightMyRequestResponse & { data: any }> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.as) headers.authorization = `Bearer ${options.as.accessToken}`;
  if (options.cookie) headers.cookie = options.cookie;
  const res = await h.app.inject({
    method,
    url: `${API_PREFIX}${path}`,
    headers,
    ...(options.body !== undefined ? { payload: options.body as object } : {}),
  });
  let data: unknown = null;
  try {
    data = res.body ? JSON.parse(res.body) : null;
  } catch {
    data = res.body;
  }
  return Object.assign(res, { data });
}

/** The `name=value` pair of the refresh cookie set by a response. */
export function refreshCookie(res: LightMyRequestResponse): string {
  const c = res.cookies.find((x) => x.name === "ew_refresh");
  if (!c) throw new Error(`No refresh cookie in response (${res.statusCode} ${res.body})`);
  return `ew_refresh=${c.value}`;
}

let counter = 0;
export async function register(h: Harness, username?: string): Promise<TestUser> {
  const name = username ?? `user${++counter}${Math.floor(Math.random() * 1e6)}`;
  const res = await call(h, "POST", "/auth/register", {
    body: { email: `${name}@example.test`, username: name, password: TEST_PASSWORD, displayName: name.toUpperCase() },
  });
  if (res.statusCode !== 201 || !res.data.session) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  return { ...res.data.session, cookie: refreshCookie(res), password: TEST_PASSWORD };
}

/** Makes two users friends. */
export async function befriend(h: Harness, a: TestUser, b: TestUser): Promise<void> {
  const req = await call(h, "POST", "/friends/requests", { as: a, body: { userId: b.user.id } });
  if (req.statusCode !== 201) throw new Error(`friend request failed: ${req.body}`);
  const ok = await call(h, "POST", `/friends/requests/${req.data.requestId}/accept`, { as: b });
  if (ok.statusCode !== 204) throw new Error(`accept failed: ${ok.body}`);
}
