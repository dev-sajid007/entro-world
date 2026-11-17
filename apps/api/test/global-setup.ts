import pg from "pg";
import { createDatabase, runMigrations, seedAcademy, seedMarket, seedWorld } from "@entroworld/database";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://entroworld:entroworld@127.0.0.1:5432/entroworld_test";

/** Creates the test database if needed and migrates it. Requires `docker compose up -d postgres redis`. */
export default async function setup(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const name = url.pathname.slice(1);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Unexpected test database name "${name}"`);
  const admin = new URL(TEST_DATABASE_URL);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  try {
    await client.connect();
  } catch (e) {
    throw new Error(`API tests need PostgreSQL at ${url.host} (run "docker compose up -d postgres redis"): ${(e as Error).message}`);
  }
  try {
    const exists = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (exists.rowCount === 0) await client.query(`create database "${name}"`);
  } finally {
    await client.end();
  }
  const { db, close } = createDatabase(TEST_DATABASE_URL, { max: 1 });
  try {
    await runMigrations(db);
    await seedWorld(db);
    await seedMarket(db);
    await seedAcademy(db);
  } finally {
    await close();
  }
}
