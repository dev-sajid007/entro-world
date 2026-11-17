import { createDatabase } from "../client";
import { seedAcademy } from "../academy-seed";
import { seedMarket } from "../market-seed";
import { seedWorld } from "../repositories";
import { databaseUrl } from "./env";

const { db, close } = createDatabase(databaseUrl, { max: 1, applicationName: "entroworld-seed" });
try {
  const worldId = await seedWorld(db);
  await seedMarket(db);
  await seedAcademy(db);
  console.log(`Seeded world ${worldId}, its zones, AI Agent Street and the Coding Academy.`);
} finally {
  await close();
}
