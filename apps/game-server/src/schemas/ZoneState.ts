import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * Synchronized state of one zone room. Field names mirror `PlayerStateShape` / `ObjectStateShape`
 * in @entroworld/game-protocol; clients decode through reflection, so the order here is the wire order.
 */
export const PlayerState = schema(
  {
    userId: t.string(),
    username: t.string(),
    displayName: t.string(),
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
    vy: t.float32(),
    rot: t.float32(),
    anim: t.uint8(),
    emote: t.string(),
    grounded: t.boolean(),
    /** Last input sequence the server applied, for client reconciliation. */
    seq: t.uint32(),
    /** JSON-encoded AvatarConfig. */
    avatar: t.string(),
    seatId: t.string(),
    voice: t.boolean(),
    speaking: t.boolean(),
  },
  "PlayerState",
);
export type PlayerState = SchemaType<typeof PlayerState>;

export const ObjectState = schema(
  {
    id: t.string(),
    kind: t.string(),
    /** Session id of the player using the object (seats), or "". */
    occupant: t.string(),
    active: t.boolean(),
    value: t.string(),
  },
  "ObjectState",
);
export type ObjectState = SchemaType<typeof ObjectState>;

/** An AI shopkeeper standing in its shop. Field names mirror `NpcStateShape`. */
export const NpcState = schema(
  {
    id: t.string(),
    shopSlug: t.string(),
    agentId: t.string(),
    name: t.string(),
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
    rot: t.float32(),
    /** One of NPC_STATES: idle, listening, thinking, talking. */
    anim: t.string(),
    /** JSON-encoded AvatarConfig. */
    avatar: t.string(),
  },
  "NpcState",
);
export type NpcState = SchemaType<typeof NpcState>;

export const ZoneState = schema(
  {
    zoneId: t.string(),
    /**
     * Interest management: players are only sent to clients whose StateView contains them
     * (see InterestManager), so far-away players cost no bandwidth.
     */
    players: t.map(PlayerState).view(),
    objects: t.map(ObjectState),
    /** A handful per zone at most, so everyone in the room receives all of them. */
    npcs: t.map(NpcState),
  },
  "ZoneState",
);
export type ZoneState = SchemaType<typeof ZoneState>;
