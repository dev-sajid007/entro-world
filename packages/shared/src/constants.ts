export const LIMITS = {
  username: { min: 3, max: 24 },
  displayName: { min: 1, max: 48 },
  password: { min: 10, max: 256 },
  bio: { max: 500 },
  postContent: { max: 5000 },
  commentContent: { max: 2000 },
  messageContent: { max: 4000 },
  chatMessage: { max: 280 },
  eventTitle: { max: 120 },
  eventDescription: { max: 4000 },
  conversationTitle: { max: 80 },
  groupMembers: { max: 50 },
  mediaPerPost: { max: 4 },
  imageBytes: 10 * 1024 * 1024,
  videoBytes: 50 * 1024 * 1024,
  furniturePerProperty: 40,
} as const;

/** Username: letters, numbers, underscore, dot. Must start with a letter. */
export const USERNAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_.]{2,23}$/;

export const NETWORK = {
  /** Server simulation tick rate (ticks per second). */
  serverTickRate: 20,
  /** State patch rate in milliseconds. */
  patchRateMs: 50,
  /** Client renders remote players this many ms in the past. */
  interpolationDelayMs: 110,
  /** Players further than this are not synchronized to a client (interest management). */
  viewRadius: 110,
  /** Proximity voice radius in meters. */
  voiceRadius: 22,
  /** Default room capacity for initial multiplayer testing. */
  defaultRoomCapacity: 50,
} as const;

export const REALTIME = {
  heartbeatMs: 25_000,
  presenceTtlSeconds: 70,
  typingTtlMs: 6_000,
} as const;
