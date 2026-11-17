import { generateAvatar } from "@entroworld/avatar";
import { apiEnvSchema, loadEnv } from "@entroworld/config";
import { createDatabase, friendships, posts, profiles, saveAvatar, seedWorld, users } from "@entroworld/database";
import { sql } from "drizzle-orm";
import { hashPassword } from "../lib/passwords";

/**
 * Development only: creates two demo accounts that are friends, with a few posts, so the social
 * features can be tried without registering. Idempotent. Run with `pnpm --filter @entroworld/api seed:demo`.
 * Password: DEMO_USER_PASSWORD, or the local-only default below.
 */
const DEFAULT_DEMO_PASSWORD = "entroworld-demo-2026";

const env = loadEnv(apiEnvSchema);
if (env.NODE_ENV === "production") throw new Error("Refusing to create demo accounts in production");
const password = process.env.DEMO_USER_PASSWORD ?? DEFAULT_DEMO_PASSWORD;

const DEMO = [
  { username: "ada_demo", displayName: "Ada (demo)", bio: "Usually found by the plaza fountain." },
  { username: "ben_demo", displayName: "Ben (demo)", bio: "Park bench enthusiast." },
];

const { db, close } = createDatabase(env.DATABASE_URL, { max: 1 });
try {
  await seedWorld(db);
  const passwordHash = await hashPassword(password);
  const ids: string[] = [];
  for (const d of DEMO) {
    const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${d.username}`).limit(1);
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const [row] = await db
      .insert(users)
      .values({ email: `${d.username}@example.test`, username: d.username, displayName: d.displayName, passwordHash, emailVerifiedAt: new Date() })
      .returning({ id: users.id });
    await db.insert(profiles).values({ userId: row!.id, bio: d.bio });
    await saveAvatar(db, row!.id, generateAvatar(d.username));
    await db.insert(posts).values({ userId: row!.id, content: `Hi, I'm ${d.displayName}! ${d.bio}` });
    if (d.username === "ada_demo") {
      await db.insert(posts).values({
        userId: row!.id,
        content: "Pinned a note on the plaza board — come say hi!",
        postType: "location",
        location: { zoneId: "zone-central", x: 22, y: 0, z: -62 },
      });
    }
    ids.push(row!.id);
  }
  await db.insert(friendships).values({ requesterId: ids[0]!, addresseeId: ids[1]!, status: "accepted" }).onConflictDoNothing();
  console.log(`Demo accounts ready: ${DEMO.map((d) => d.username).join(", ")} (password from DEMO_USER_PASSWORD or the default in src/cli/seed-demo.ts).`);
} finally {
  await close();
}
