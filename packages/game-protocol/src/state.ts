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

export interface ZoneStateShape {
  zoneId: string;
  players: Map<string, PlayerStateShape> & { forEach(cb: (value: PlayerStateShape, key: string) => void): void };
  objects: Map<string, ObjectStateShape> & { forEach(cb: (value: ObjectStateShape, key: string) => void): void };
}
