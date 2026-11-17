import { createDatabase } from "../client";
import { runMigrations } from "../migrate";
import { databaseUrl } from "./env";

const { db, close } = createDatabase(databaseUrl, { max: 1, applicationName: "entroworld-migrate" });
try {
  await runMigrations(db);
  console.log("Migrations applied.");
} finally {
  await close();
}
