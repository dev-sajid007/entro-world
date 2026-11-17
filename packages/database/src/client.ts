import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction (both expose the same query builder). */
export type DbExecutor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface DatabaseConnection {
  db: Database;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDatabase(url: string, options: { max?: number; applicationName?: string } = {}): DatabaseConnection {
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max ?? 10,
    application_name: options.applicationName ?? "entroworld",
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // An idle client erroring (e.g. Postgres restart) must not crash the process.
  pool.on("error", () => undefined);
  const db = drizzle({ client: pool, schema });
  return { db, pool, close: () => pool.end() };
}

/** True when the error is a Postgres unique-constraint violation (optionally on a given constraint). */
export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const e = findPgError(error);
  return !!e && e.code === "23505" && (!constraint || e.constraint === constraint);
}

export function isForeignKeyViolation(error: unknown): boolean {
  return findPgError(error)?.code === "23503";
}

function findPgError(error: unknown): { code?: string; constraint?: string } | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const e = current as { code?: unknown; constraint?: string; cause?: unknown };
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) return e as { code: string; constraint?: string };
    current = e.cause;
  }
  return null;
}
