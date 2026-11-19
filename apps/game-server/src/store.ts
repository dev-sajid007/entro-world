import { generateAvatar } from "@entroworld/avatar";
import {
  closeServerInstances,
  createDatabase,
  getAvatar,
  getLessonPuzzle,
  listShopkeepers,
  saveWorldStates,
  upsertWorldInstance,
  type LessonPuzzleRecord,
  type ShopkeeperRecord,
  type StoredWorldPosition,
} from "@entroworld/database";

export type { LessonPuzzleRecord, ShopkeeperRecord };
import type { AvatarConfig, ZoneId } from "@entroworld/shared";
import { getCityLayout } from "@entroworld/world-assets";

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
  /** AI shopkeepers open in a zone. */
  shopkeepers(zoneId: ZoneId): Promise<ShopkeeperRecord[]>;
  /** A published lesson's puzzle (Academy sessions replay battle attempts against it). */
  lessonPuzzle(lessonId: string): Promise<LessonPuzzleRecord | null>;
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
    shopkeepers: (zoneId) => listShopkeepers(db, zoneId),
    lessonPuzzle: (lessonId) => getLessonPuzzle(db, lessonId),
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
  /** Shopkeepers by shop slug (none unless a test adds them: there is no agent registry offline). */
  shops: Map<string, ShopkeeperRecord>;
  /** Lesson puzzles by lesson id (tests add them). */
  lessons: Map<string, LessonPuzzleRecord>;
} {
  const positions = new Map<string, SavedPosition>();
  const instances = new Map<string, InstanceRecord>();
  const avatars = new Map<string, AvatarConfig>();
  const shops = new Map<string, ShopkeeperRecord>();
  const lessons = new Map<string, LessonPuzzleRecord>();
  return {
    lessons,
    positions,
    instances,
    avatars,
    shops,
    async avatar(userId, username) {
      return avatars.get(userId) ?? generateAvatar(username);
    },
    async savePositions(rows) {
      for (const r of rows) positions.set(r.userId, { ...r });
    },
    async recordInstance(instance) {
      instances.set(instance.roomId, { ...instance });
    },
    async shopkeepers(zoneId) {
      const slugs = new Set(getCityLayout().shops.filter((s) => s.zoneId === zoneId).map((s) => s.slug));
      return [...shops.values()].filter((s) => slugs.has(s.shopSlug));
    },
    async lessonPuzzle(lessonId) {
      return lessons.get(lessonId) ?? null;
    },
    async closeServerInstances(serverId) {
      for (const i of instances.values()) if (i.serverId === serverId) Object.assign(i, { status: "closed", currentPlayers: 0 });
    },
    async close() {},
  };
}
