import type { FastifyInstance } from "fastify";
import { Redis } from "ioredis";
import { eq, sql } from "drizzle-orm";
import { INTERNAL_TOKEN_HEADER, SseDecoder, type AgentStreamEvent } from "@entroworld/agent-protocol";
import { aiEnvSchema, internalServiceToken, loadEnv, type AiEnv } from "@entroworld/config";
import { agentConversations, aiAgents, createDatabase, marketShops, seedMarket, users, type Database } from "@entroworld/database";
import { NPC_CONTROL_CHANNEL, type NpcControl } from "@entroworld/game-protocol";
import { buildAiApp } from "../src/app";
import { ProviderError, type LlmProvider, type ProviderRequest, type ProviderResult } from "../src/providers/types";
import { TEST_DATABASE_URL } from "./global-setup";

const TEST_REDIS_URL = process.env.TEST_AI_REDIS_URL ?? "redis://127.0.0.1:6379/13";

export interface Script {
  chunks?: string[];
  stopReason?: ProviderResult["stopReason"];
  /** Wait before each chunk (ms). */
  delayMs?: number;
  fail?: ProviderError["kind"];
  /** Builds the chunks from the request (e.g. to echo the system prompt). */
  from?: (request: ProviderRequest) => string[];
}

/** A provider whose answers the test decides; records every request it receives. */
export class ScriptedProvider implements LlmProvider {
  readonly name = "scripted";
  readonly requests: ProviderRequest[] = [];
  next: Script = { chunks: ["Hello ", "from ", "Byte!"] };

  async stream(request: ProviderRequest, onText: (text: string) => void): Promise<ProviderResult> {
    this.requests.push(request);
    const script = this.next;
    if (script.fail) throw new ProviderError(script.fail, "scripted failure");
    const chunks = script.from ? script.from(request) : (script.chunks ?? []);
    let text = "";
    for (const chunk of chunks) {
      if (script.delayMs) await new Promise((r) => setTimeout(r, script.delayMs));
      if (request.signal.aborted) throw new ProviderError("aborted", "aborted");
      text += chunk;
      onText(chunk);
    }
    return { text, stopReason: script.stopReason ?? "end_turn", usage: { inputTokens: 100, outputTokens: 20 }, model: "scripted" };
  }
}

export interface Harness {
  app: FastifyInstance;
  env: AiEnv;
  db: Database;
  redis: Redis;
  provider: ScriptedProvider;
  token: string;
  agentId: string;
  /** NPC animation messages published since the last reset. */
  npc: NpcControl[];
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function createHarness(overrides: Record<string, string> = {}): Promise<Harness> {
  const env = loadEnv(aiEnvSchema, {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_URL: TEST_DATABASE_URL,
    REDIS_URL: TEST_REDIS_URL,
    GAME_TICKET_SECRET: "test-ticket-secret-0123456789abcdef0123456789",
    AI_USER_DAILY_REQUEST_LIMIT: "5",
    ...overrides,
  });
  const connection = createDatabase(env.DATABASE_URL, { max: 4 });
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2 });
  const npc: NpcControl[] = [];
  await subscriber.subscribe(NPC_CONTROL_CHANNEL);
  subscriber.on("message", (_channel, message) => npc.push(JSON.parse(message) as NpcControl));
  const provider = new ScriptedProvider();
  const app = await buildAiApp({ env, db: connection.db, redis, provider }, { logger: false });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const codeCornerAgent = async () => {
    const [agent] = await connection.db
      .select({ id: aiAgents.id })
      .from(aiAgents)
      .innerJoin(marketShops, eq(marketShops.id, aiAgents.shopId))
      .where(eq(marketShops.slug, "code-corner"));
    return agent!.id;
  };
  const harness: Harness = {
    app,
    env,
    db: connection.db,
    redis,
    provider,
    token: internalServiceToken(env),
    agentId: await codeCornerAgent(),
    npc,
    async reset() {
      // Cascades into the market tables too (shops reference users as owners), so re-seed them.
      await connection.db.execute(sql`truncate users restart identity cascade`);
      await seedMarket(connection.db);
      harness.agentId = await codeCornerAgent();
      await redis.flushdb();
      provider.requests.length = 0;
      provider.next = { chunks: ["Hello ", "from ", "Byte!"] };
      npc.length = 0;
    },
    async close() {
      await app.close();
      await connection.close();
      redis.disconnect();
      subscriber.disconnect();
    },
  };
  return harness;
}

let userCounter = 0;

export async function createUser(h: Harness): Promise<string> {
  userCounter++;
  const [row] = await h.db
    .insert(users)
    .values({ email: `ai${userCounter}-${Date.now()}@example.test`, username: `ai_user_${userCounter}_${Date.now() % 100000}`, displayName: "AI tester", passwordHash: "x" })
    .returning({ id: users.id });
  return row!.id;
}

export async function createConversation(h: Harness, userId: string): Promise<string> {
  const [row] = await h.db.insert(agentConversations).values({ agentId: h.agentId, userId }).returning({ id: agentConversations.id });
  return row!.id;
}

export interface StreamResult {
  status: number;
  events: AgentStreamEvent[];
  json: any;
  text: string;
}

/** Sends a message and collects the whole SSE response. */
export async function send(
  h: Harness,
  conversationId: string,
  body: { userId: string; content: string; clientMessageId?: string },
  options: { token?: string | null; signal?: AbortSignal } = {},
): Promise<StreamResult> {
  const address = h.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = options.token === undefined ? h.token : options.token;
  if (token) headers[INTERNAL_TOKEN_HEADER] = token;
  const res = await fetch(`http://127.0.0.1:${port}/internal/v1/conversations/${conversationId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({ clientMessageId: crypto.randomUUID(), ...body }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  const text = await res.text();
  if (!res.headers.get("content-type")?.startsWith("text/event-stream")) {
    return { status: res.status, events: [], json: JSON.parse(text), text };
  }
  return { status: res.status, events: new SseDecoder().push(text), json: null, text };
}

export const deltas = (events: AgentStreamEvent[]) => events.map((e) => (e.type === "delta" ? e.text : "")).join("");
