import { generateAvatar } from "@entroworld/avatar";
import { npcControlSchema, type NpcAnimState } from "@entroworld/game-protocol";
import type { ShopPresencePayload } from "@entroworld/game-protocol";
import type { ZoneId } from "@entroworld/shared";
import { getCityLayout, type MarketShop } from "@entroworld/world-assets";
import { NpcState } from "../schemas/ZoneState";
import type { ShopkeeperRecord } from "../store";

/** A conversation state the AI service never ended (crash, lost message) stops counting after this. */
export const NPC_STATE_TTL_MS = 120_000;
/** Customers are noticed a little beyond the counter trigger. */
const NOTICE_RANGE = 1.6;
/** How fast a shopkeeper turns towards a customer (rad/s). */
const TURN_RATE = 4;

interface Keeper {
  shop: MarketShop;
  record: ShopkeeperRecord;
  state: NpcState;
  /** What the AI service last said per conversation, with when it said it. */
  conversations: Map<string, { state: Exclude<NpcAnimState, "listening" | "idle">; at: number }>;
}

export interface CustomerPosition {
  sessionId: string;
  x: number;
  z: number;
  /** False for players that can't shop right now (seated, transferring, disconnected). */
  present: boolean;
}

export type ShopEvent = { sessionId: string; type: "enter"; payload: ShopPresencePayload } | { sessionId: string; type: "leave"; payload: ShopPresencePayload };

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * AI shopkeeper NPCs of one zone room. The AI agent service reports what each agent is doing
 * (thinking / talking / idle) over pub/sub; this turns that into an animation state, turns the
 * shopkeeper towards its customers and tells clients when they step up to a counter. Nothing
 * here waits on the AI: the room tick only reads what has already arrived.
 */
export class Shopkeepers {
  private readonly keepers = new Map<string, Keeper>();
  /** Which shop counter each session is standing at. */
  private readonly at = new Map<string, string>();
  readonly shops: MarketShop[];

  constructor(zoneId: ZoneId) {
    this.shops = getCityLayout().shops.filter((s) => s.zoneId === zoneId && s.open);
  }

  get size(): number {
    return this.keepers.size;
  }

  /**
   * Replaces the set of shopkeepers with what the registry says is open. Returns NPC states to
   * add to and ids to remove from the synchronized map.
   */
  sync(records: ShopkeeperRecord[]): { added: NpcState[]; removed: string[] } {
    const wanted = new Map<string, ShopkeeperRecord>();
    for (const r of records) if (this.shops.some((s) => s.slug === r.shopSlug)) wanted.set(r.shopSlug, r);
    const added: NpcState[] = [];
    const removed: string[] = [];
    for (const [slug, keeper] of this.keepers) {
      const next = wanted.get(slug);
      if (next && next.agentId === keeper.record.agentId) {
        keeper.record = next;
        keeper.state.name = next.name;
        continue;
      }
      this.keepers.delete(slug);
      removed.push(keeper.state.id);
    }
    for (const [slug, record] of wanted) {
      if (this.keepers.has(slug)) continue;
      const shop = this.shops.find((s) => s.slug === slug)!;
      const state = new NpcState();
      state.id = `npc:${slug}`;
      state.shopSlug = slug;
      state.agentId = record.agentId;
      state.name = record.name;
      state.x = shop.keeper.x;
      state.y = 0;
      state.z = shop.keeper.z;
      state.rot = shop.keeper.rotation;
      state.anim = "idle";
      state.avatar = JSON.stringify(generateAvatar(record.avatarSeed));
      this.keepers.set(slug, { shop, record, state, conversations: new Map() });
      added.push(state);
    }
    return { added, removed };
  }

  /** Applies a message from the AI agent service; ignores anything malformed or for other zones. */
  control(raw: unknown, now = Date.now()): void {
    const parsed = npcControlSchema.safeParse(raw);
    if (!parsed.success) return;
    const { agentId, conversationId, state } = parsed.data;
    for (const keeper of this.keepers.values()) {
      if (keeper.record.agentId !== agentId) continue;
      if (state === "idle") keeper.conversations.delete(conversationId);
      else keeper.conversations.set(conversationId, { state, at: now });
    }
  }

  /** Updates animations and facing; returns counter enter/leave events for clients. */
  update(customers: CustomerPosition[], dt: number, now = Date.now()): ShopEvent[] {
    const events: ShopEvent[] = [];
    const seen = new Set<string>();
    for (const c of customers) {
      seen.add(c.sessionId);
      const inside = c.present ? this.shops.find((s) => this.keepers.has(s.slug) && Math.hypot(c.x - s.trigger.x, c.z - s.trigger.z) <= s.trigger.radius) : undefined;
      const was = this.at.get(c.sessionId);
      if (was === inside?.slug) continue;
      if (was) {
        this.at.delete(c.sessionId);
        const k = this.keepers.get(was);
        if (k) events.push({ sessionId: c.sessionId, type: "leave", payload: { shopSlug: was, agentId: k.record.agentId } });
      }
      if (inside) {
        this.at.set(c.sessionId, inside.slug);
        events.push({ sessionId: c.sessionId, type: "enter", payload: { shopSlug: inside.slug, agentId: this.keepers.get(inside.slug)!.record.agentId } });
      }
    }
    for (const sessionId of [...this.at.keys()]) if (!seen.has(sessionId)) this.at.delete(sessionId);

    for (const keeper of this.keepers.values()) {
      let busy: NpcAnimState | null = null;
      for (const [id, c] of keeper.conversations) {
        if (now - c.at > NPC_STATE_TTL_MS) keeper.conversations.delete(id);
        else if (c.state === "talking") busy = "talking";
        else if (!busy) busy = "thinking";
      }
      const { trigger, keeper: home } = keeper.shop;
      let nearest: CustomerPosition | null = null;
      let best = trigger.radius + NOTICE_RANGE;
      for (const c of customers) {
        if (!c.present) continue;
        const d = Math.hypot(c.x - trigger.x, c.z - trigger.z);
        if (d < best) {
          best = d;
          nearest = c;
        }
      }
      const anim = busy ?? (nearest ? "listening" : "idle");
      if (keeper.state.anim !== anim) keeper.state.anim = anim;

      // Face the nearest customer, or the shop door when nobody is around.
      const target = nearest ? Math.atan2(-(nearest.x - home.x), -(nearest.z - home.z)) : home.rotation;
      const diff = wrapAngle(target - keeper.state.rot);
      if (Math.abs(diff) > 0.01) {
        const step = Math.sign(diff) * Math.min(Math.abs(diff), TURN_RATE * dt);
        keeper.state.rot = wrapAngle(keeper.state.rot + step);
      }
    }
    return events;
  }

  /** The shop a session is standing in, if any (to send on reconnect). */
  shopOf(sessionId: string): ShopPresencePayload | null {
    const slug = this.at.get(sessionId);
    const k = slug ? this.keepers.get(slug) : undefined;
    return slug && k ? { shopSlug: slug, agentId: k.record.agentId } : null;
  }

  forget(sessionId: string): void {
    this.at.delete(sessionId);
  }
}
