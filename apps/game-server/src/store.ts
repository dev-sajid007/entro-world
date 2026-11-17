import { generateAvatar } from "@entroworld/avatar";
import {
  closeServerInstances,
  createDatabase,
  getAvatar,
  saveWorldStates,
  upsertWorldInstance,
  type StoredWorldPosition,
} from "@entroworld/database";
import type { AvatarConfig, ZoneId } from "@entroworld/shared";

export type SavedPosition = { userId: string } & StoredWorldPosition;

export interface InstanceRecord {
  roomId: string;
  zoneId: ZoneId;
  serverId: string;
  currentPlayers: number;
  status: "open" | "closed";
}

/** Persistent data the game server reads and writes (PostgreSQL in deployments). */
export interface WorldStore {
  avatar(userId: string, username: string): Promise<AvatarConfig>;
  savePositions(rows: SavedPosition[]): Promise<void>;
  recordInstance(instance: InstanceRecord): Promise<void>;
  /** Marks every instance of this server closed (startup after a crash). */
  closeServerInstances(serverId: string): Promise<void>;
  close(): Promise<void>;
}

export function databaseStore(url: string): WorldStore {
  const { db, close } = createDatabase(url, { max: 5, applicationName: "entroworld-game" });
  return {
    avatar: (userId, username) => getAvatar(db, userId, username),
    savePositions: (rows) => saveWorldStates(db, rows),
    recordInstance: (instance) => upsertWorldInstance(db, instance),
    closeServerInstances: (serverId) => closeServerInstances(db, serverId),
    close,
  };
}

/**
 * Keeps everything in memory, with avatars generated from the username (as the web client does
 * for guests). Used by tests and when running without a database.
 */
export function memoryStore(): WorldStore & {
  positions: Map<string, SavedPosition>;
  instances: Map<string, InstanceRecord>;
  avatars: Map<string, AvatarConfig>;
} {
  const positions = new Map<string, SavedPosition>();
  const instances = new Map<string, InstanceRecord>();
  const avatars = new Map<string, AvatarConfig>();
  return {
    positions,
    instances,
    avatars,
    async avatar(userId, username) {
      return avatars.get(userId) ?? generateAvatar(username);
    },
    async savePositions(rows) {
      for (const r of rows) positions.set(r.userId, { ...r });
    },
    async recordInstance(instance) {
      instances.set(instance.roomId, { ...instance });
    },
    async closeServerInstances(serverId) {
      for (const i of instances.values()) if (i.serverId === serverId) Object.assign(i, { status: "closed", currentPlayers: 0 });
    },
    async close() {},
  };
}
