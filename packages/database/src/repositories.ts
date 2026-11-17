import { and, eq, sql } from "drizzle-orm";
import { generateAvatar, sanitizeAvatarConfig } from "@entroworld/avatar";
import { ZONES, ZONE_IDS, type AvatarConfig, type ZoneId } from "@entroworld/shared";
import type { DbExecutor } from "./client";
import { avatars, userWorldState, worldInstances, worldZones, worlds } from "./schema";

// Small data-access helpers shared by the API and the game server.

export const DEFAULT_WORLD_SLUG = "entro-city";

export async function getAvatar(db: DbExecutor, userId: string, fallbackSeed: string): Promise<AvatarConfig> {
  const [row] = await db.select().from(avatars).where(eq(avatars.userId, userId)).limit(1);
  if (!row) return generateAvatar(fallbackSeed);
  return sanitizeAvatarConfig({ modelId: row.modelId, appearance: row.appearance, clothing: row.clothing, accessories: row.accessories }, fallbackSeed);
}

export async function saveAvatar(db: DbExecutor, userId: string, avatar: AvatarConfig): Promise<void> {
  const values = { modelId: avatar.modelId, appearance: avatar.appearance, clothing: avatar.clothing, accessories: avatar.accessories };
  await db
    .insert(avatars)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: avatars.userId, set: { ...values, updatedAt: new Date() } });
}

export interface StoredWorldPosition {
  zoneId: ZoneId;
  x: number;
  y: number;
  z: number;
  rotation: number;
}

export async function getWorldState(db: DbExecutor, userId: string): Promise<StoredWorldPosition | null> {
  const [row] = await db.select().from(userWorldState).where(eq(userWorldState.userId, userId)).limit(1);
  if (!row) return null;
  return { zoneId: row.zoneId, x: row.positionX, y: row.positionY, z: row.positionZ, rotation: row.rotation };
}

export async function saveWorldStates(db: DbExecutor, rows: ({ userId: string } & StoredWorldPosition)[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(userWorldState)
    .values(rows.map((r) => ({ userId: r.userId, zoneId: r.zoneId, positionX: r.x, positionY: r.y, positionZ: r.z, rotation: r.rotation })))
    .onConflictDoUpdate({
      target: userWorldState.userId,
      set: {
        zoneId: sql`excluded.zone_id`,
        positionX: sql`excluded.position_x`,
        positionY: sql`excluded.position_y`,
        positionZ: sql`excluded.position_z`,
        rotation: sql`excluded.rotation`,
        updatedAt: new Date(),
      },
    });
}

export async function upsertWorldInstance(
  db: DbExecutor,
  instance: { roomId: string; zoneId: ZoneId; serverId: string; currentPlayers: number; status: "open" | "closed" },
): Promise<void> {
  const closedAt = instance.status === "closed" ? new Date() : null;
  await db
    .insert(worldInstances)
    .values({ ...instance, closedAt })
    .onConflictDoUpdate({
      target: worldInstances.roomId,
      set: { currentPlayers: instance.currentPlayers, status: instance.status, serverId: instance.serverId, closedAt, updatedAt: new Date() },
    });
}

/** Marks every open instance of a server closed (startup after a crash, or shutdown). */
export async function closeServerInstances(db: DbExecutor, serverId: string): Promise<void> {
  await db
    .update(worldInstances)
    .set({ status: "closed", currentPlayers: 0, closedAt: new Date() })
    .where(and(eq(worldInstances.serverId, serverId), eq(worldInstances.status, "open")));
}

/** Idempotently creates the city world and its zones. */
export async function seedWorld(db: DbExecutor): Promise<string> {
  const [world] = await db
    .insert(worlds)
    .values({ slug: DEFAULT_WORLD_SLUG, name: "Entro City" })
    .onConflictDoUpdate({ target: worlds.slug, set: { name: "Entro City" } })
    .returning({ id: worlds.id });
  const worldId = world!.id;
  for (const zoneId of ZONE_IDS) {
    const zone = ZONES[zoneId];
    await db
      .insert(worldZones)
      .values({ worldId, slug: zoneId, name: zone.name, description: zone.description })
      .onConflictDoUpdate({ target: worldZones.slug, set: { name: zone.name, description: zone.description, worldId } });
  }
  return worldId;
}
