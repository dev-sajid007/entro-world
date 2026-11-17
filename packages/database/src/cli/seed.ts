import { createDatabase } from "../client";
import { seedWorld } from "../repositories";
import { databaseUrl } from "./env";

const { db, close } = createDatabase(databaseUrl, { max: 1, applicationName: "entroworld-seed" });
try {
  const worldId = await seedWorld(db);
  console.log(`Seeded world ${worldId} and its zones.`);
} finally {
  await close();
}
