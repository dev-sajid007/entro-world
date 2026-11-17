import type { Redis } from "ioredis";
import { USER_CONTROL_CHANNEL, onlineKey, type UserControl } from "@entroworld/game-protocol";
import { isZoneId, type ZoneId } from "@entroworld/shared";

/** Reads online status written by the game servers and sends them user-control commands. */
export class PresenceReader {
  constructor(private readonly redis: Redis) {}

  /** Zone of each online user; users not in the map are offline. */
  async zones(userIds: readonly string[]): Promise<Map<string, ZoneId>> {
    const result = new Map<string, ZoneId>();
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return result;
    const values = await this.redis.mget(...unique.map(onlineKey));
    unique.forEach((id, i) => {
      const v = values[i];
      if (isZoneId(v)) result.set(id, v);
    });
    return result;
  }

  /** Broadcasts a command to every game server. */
  async control(command: UserControl): Promise<void> {
    await this.redis.publish(USER_CONTROL_CHANNEL, JSON.stringify(command));
  }
}
