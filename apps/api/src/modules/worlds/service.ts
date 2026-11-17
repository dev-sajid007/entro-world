import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getWorldState, users, worldInstances, worldZones, worlds } from "@entroworld/database";
import { DEFAULT_ZONE, type WorldInstanceView, type WorldJoinResponse, type WorldView, type ZoneId, type ZoneView } from "@entroworld/shared";
import { getZoneLayout } from "@entroworld/world-assets";
import type { AppContext } from "../../context";
import { AppError, forbidden, notFound } from "../../lib/errors";

export class WorldsService {
  constructor(private readonly ctx: AppContext) {}

  private get db() {
    return this.ctx.db;
  }

  async list(): Promise<WorldView[]> {
    const [worldRows, zones] = await Promise.all([this.db.select().from(worlds).orderBy(asc(worlds.name)), this.zones()]);
    return worldRows.map((w) => ({ id: w.id, name: w.name, slug: w.slug, zones: zones.filter((z) => z.worldId === w.id) }));
  }

  /** Zones (of one world, or all), with live player counts from open room instances. */
  async zones(worldId?: string): Promise<ZoneView[]> {
    if (worldId) {
      const [world] = await this.db.select({ id: worlds.id }).from(worlds).where(eq(worlds.id, worldId)).limit(1);
      if (!world) throw notFound("World");
    }
    const players = sql<number>`coalesce((select sum(${worldInstances.currentPlayers}) from ${worldInstances} where ${worldInstances.zoneId} = ${worldZones.slug} and ${worldInstances.status} = 'open'), 0)::int`;
    const rows = await this.db
      .select({ zone: worldZones, onlinePlayers: players })
      .from(worldZones)
      .where(worldId ? eq(worldZones.worldId, worldId) : undefined)
      .orderBy(asc(worldZones.name));
    return rows.map(({ zone, onlinePlayers }) => ({
      id: zone.slug,
      name: zone.name,
      description: zone.description,
      worldId: zone.worldId,
      isActive: zone.isActive,
      onlinePlayers,
    }));
  }

  async zone(zoneId: ZoneId): Promise<ZoneView> {
    const zone = (await this.zones()).find((z) => z.id === zoneId);
    if (!zone) throw notFound("Zone");
    return zone;
  }

  /**
   * Issues a single-use ticket for a zone room. Players return to where they last were, unless
   * they asked for a different zone (then they arrive at its spawn point).
   */
  async join(userId: string, requested: ZoneId | undefined): Promise<WorldJoinResponse> {
    const [user] = await this.db
      .select({ username: users.username, displayName: users.displayName, status: users.status, deletedAt: users.deletedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user || user.deletedAt) throw notFound("User");
    if (user.status !== "active") throw forbidden("This account is suspended", "account_suspended");

    const saved = await getWorldState(this.db, userId);
    const zoneId = requested ?? saved?.zoneId ?? DEFAULT_ZONE;
    const [zone] = await this.db.select({ isActive: worldZones.isActive }).from(worldZones).where(eq(worldZones.slug, zoneId)).limit(1);
    if (!zone) throw notFound("Zone");
    if (!zone.isActive) throw new AppError(409, "zone_closed", "This area is closed right now");

    const spawn = saved && saved.zoneId === zoneId ? { x: saved.x, y: saved.y, z: saved.z, rotation: saved.rotation } : getZoneLayout(zoneId).spawn;
    const { ticket, expiresAt } = await this.ctx.gameTickets.sign({ sub: userId, username: user.username, displayName: user.displayName, zoneId, spawn });
    return { ticket, zoneId, gameServerUrl: this.ctx.env.GAME_SERVER_PUBLIC_URL, spawn, expiresAt: expiresAt.toISOString() };
  }

  /** Disconnects the user's game sessions everywhere. */
  async leave(userId: string): Promise<void> {
    await this.ctx.presence.control({ type: "disconnect", userId, reason: "left" });
  }

  async instances(): Promise<WorldInstanceView[]> {
    const rows = await this.db
      .select()
      .from(worldInstances)
      .where(and(eq(worldInstances.status, "open")))
      .orderBy(asc(worldInstances.zoneId), desc(worldInstances.currentPlayers));
    return rows.map((r) => ({
      id: r.id,
      zoneId: r.zoneId,
      roomId: r.roomId,
      serverId: r.serverId,
      status: r.status,
      currentPlayers: r.currentPlayers,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}
