import type { PhysicsWorld } from "@entroworld/game-engine";
import type { Logger } from "./logger";
import type { GameMetrics } from "./metrics";
import type { WorldStore } from "./store";
import type { ReplayGuard, TicketService } from "./tickets";
import type { VoiceService } from "./systems/voice";

/**
 * Process-wide dependencies for rooms. Colyseus constructs rooms itself and room options must
 * stay serializable (they can cross processes through the driver), so rooms read these instead.
 */
export interface GameServices {
  serverId: string;
  physics: PhysicsWorld;
  tickets: TicketService;
  /** Created lazily from room presence when not supplied (needs a live presence instance). */
  replay: ReplayGuard | null;
  /** Avatars, saved positions and room instance bookkeeping. */
  store: WorldStore;
  voice: VoiceService | null;
  metrics: GameMetrics;
  logger: Logger;
}

let current: GameServices | null = null;

export function setServices(services: GameServices): void {
  current = services;
}

export function services(): GameServices {
  if (!current) throw new Error("Game services are not initialized");
  return current;
}
