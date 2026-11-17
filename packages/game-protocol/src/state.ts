/**
 * Plain-TypeScript mirror of the synchronized room state. The server defines the actual
 * @colyseus/schema classes; clients decode via reflection and use these interfaces for typing.
 */
export interface PlayerStateShape {
  userId: string;
  username: string;
  displayName: string;
  x: number;
  y: number;
  z: number;
  vy: number;
  rot: number;
  anim: number;
  emote: string;
  grounded: boolean;
  /** Last input sequence processed by the server (for reconciliation). */
  seq: number;
  /** JSON-encoded AvatarConfig. */
  avatar: string;
  seatId: string;
  voice: boolean;
  speaking: boolean;
}

export interface ObjectStateShape {
  id: string;
  kind: string;
  occupant: string;
  active: boolean;
  value: string;
}

/** An AI shopkeeper. Clients look up the agent's public persona through the API by `agentId`. */
export interface NpcStateShape {
  id: string;
  shopSlug: string;
  agentId: string;
  name: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  /** One of NPC_STATES. */
  anim: string;
  /** JSON-encoded AvatarConfig. */
  avatar: string;
}

export interface ZoneStateShape {
  zoneId: string;
  players: Map<string, PlayerStateShape> & { forEach(cb: (value: PlayerStateShape, key: string) => void): void };
  objects: Map<string, ObjectStateShape> & { forEach(cb: (value: ObjectStateShape, key: string) => void): void };
  npcs: Map<string, NpcStateShape> & { forEach(cb: (value: NpcStateShape, key: string) => void): void };
}
