import { createDatabase } from "../client";
import { seedMarket } from "../market-seed";
import { seedWorld } from "../repositories";
import { databaseUrl } from "./env";

const { db, close } = createDatabase(databaseUrl, { max: 1, applicationName: "entroworld-seed" });
try {
  const worldId = await seedWorld(db);
  await seedMarket(db);
  console.log(`Seeded world ${worldId}, its zones and AI Agent Street.`);
} finally {
  await close();
}
