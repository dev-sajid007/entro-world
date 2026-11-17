import type { Redis } from "ioredis";
import { NPC_CONTROL_CHANNEL, type NpcControl } from "@entroworld/game-protocol";

/**
 * Tells game servers what a shopkeeper is doing (thinking / talking / idle) over Redis pub/sub, so
 * the NPC animates for everyone nearby. Fire-and-forget: animation must never delay an answer.
 */
export class NpcPublisher {
  constructor(private readonly redis: Redis) {}

  publish(agentId: string, conversationId: string, state: NpcControl["state"]): void {
    const message: NpcControl = { type: "npc_state", agentId, conversationId, state };
    this.redis.publish(NPC_CONTROL_CHANNEL, JSON.stringify(message)).catch(() => undefined);
  }
}
