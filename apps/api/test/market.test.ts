import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SseDecoder, type AgentStreamEvent } from "@entroworld/agent-protocol";
import { call, createHarness, register, type Harness, type TestUser } from "./harness";

let h: Harness;
beforeAll(async () => {
  h = await createHarness({}, { ai: { AI_USER_DAILY_REQUEST_LIMIT: "3" } });
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

async function byteId(user: TestUser): Promise<string> {
  const res = await call(h, "GET", "/market/shops/code-corner", { as: user });
  return res.data.agent.id;
}

async function startConversation(user: TestUser): Promise<string> {
  const res = await call(h, "POST", `/market/agents/${await byteId(user)}/conversations`, { as: user });
  expect(res.statusCode).toBe(201);
  return res.data.id;
}

async function ask(user: TestUser, conversationId: string, content: string, clientMessageId = crypto.randomUUID()) {
  const res = await call(h, "POST", `/market/conversations/${conversationId}/messages`, { as: user, body: { content, clientMessageId } });
  const events: AgentStreamEvent[] = res.headers["content-type"]?.toString().startsWith("text/event-stream") ? new SseDecoder().push(res.body) : [];
  return { res, events, text: events.map((e) => (e.type === "delta" ? e.text : "")).join("") };
}

describe("shops", () => {
  it("requires sign-in", async () => {
    expect((await call(h, "GET", "/market/shops")).statusCode).toBe(401);
  });

  it("lists AI Agent Street with only Code Corner open, without exposing prompts", async () => {
    const me = await register(h);
    const res = await call(h, "GET", "/market/shops", { as: me });
    expect(res.statusCode).toBe(200);
    expect(res.data).toHaveLength(7);
    const open = res.data.filter((s: any) => s.agent);
    expect(open.map((s: any) => s.slug)).toEqual(["code-corner"]);
    expect(open[0].agent).toMatchObject({ name: "Byte", shopSlug: "code-corner", greeting: expect.any(String) });
    expect(res.body).not.toMatch(/systemPrompt|system_prompt|modelConfig/);

    const detail = await call(h, "GET", "/market/shops/code-corner", { as: me });
    expect(detail.data.products).toEqual([
      expect.objectContaining({ name: "Code Help Chat", productType: "chat", freeQuota: 20 }),
      expect.objectContaining({ name: "Puzzle Lab Tutor", productType: "tool", freeQuota: 20 }),
    ]);
    const closed = await call(h, "GET", "/market/shops/book-cafe", { as: me });
    expect(closed.data).toMatchObject({ status: "draft", agent: null, products: [] });
    expect((await call(h, "GET", "/market/shops/nope", { as: me })).statusCode).toBe(404);
  });
});

describe("conversations", () => {
  it("streams an answer through the API and keeps the history", async () => {
    const me = await register(h);
    const id = await startConversation(me);
    const { res, events, text } = await ask(me, id, "How do arrays work?");
    expect(res.statusCode).toBe(200);
    expect(events[0]).toEqual({ type: "animation", state: "thinking" });
    expect(text).toContain("How do arrays work?");
    expect(events.at(-1)).toMatchObject({ type: "done", usage: { remaining: 2 } });

    const messages = await call(h, "GET", `/market/conversations/${id}/messages`, { as: me });
    expect(messages.data.items.map((m: any) => m.senderType)).toEqual(["agent", "user"]);
    const list = await call(h, "GET", "/market/conversations", { as: me });
    expect(list.data.items).toEqual([expect.objectContaining({ id, preview: expect.stringContaining("offline demo") })]);

    const usage = await call(h, "GET", "/market/usage/me", { as: me });
    expect(usage.data).toMatchObject({ requests: { used: 1, limit: 3, remaining: 2 } });
  });

  it("keeps conversations private", async () => {
    const me = await register(h);
    const other = await register(h);
    const id = await startConversation(me);
    await ask(me, id, "hello");
    expect((await call(h, "GET", `/market/conversations/${id}/messages`, { as: other })).statusCode).toBe(404);
    expect((await ask(other, id, "hi")).res.statusCode).toBe(404);
    expect((await call(h, "DELETE", `/market/conversations/${id}`, { as: other })).statusCode).toBe(404);
    expect((await call(h, "GET", "/market/conversations", { as: other })).data.items).toEqual([]);
  });

  it("validates messages", async () => {
    const me = await register(h);
    const id = await startConversation(me);
    const bad = [{ content: "   ", clientMessageId: crypto.randomUUID() }, { content: "x".repeat(2001), clientMessageId: crypto.randomUUID() }, { content: "hi" }];
    for (const body of bad) {
      expect((await call(h, "POST", `/market/conversations/${id}/messages`, { as: me, body })).statusCode).toBe(400);
    }
  });

  it("gives a friendly in-world message once the daily limit is used", async () => {
    const me = await register(h);
    const id = await startConversation(me);
    for (let i = 0; i < 3; i++) expect((await ask(me, id, `question ${i}`)).events.at(-1)?.type).toBe("done");
    const { events } = await ask(me, id, "one more");
    expect(events).toEqual([{ type: "error", code: "quota_exceeded", message: expect.stringMatching(/tomorrow/i) }]);
    expect((await call(h, "GET", "/market/usage/me", { as: me })).data.requests.remaining).toBe(0);
  });

  it("deletes conversations and accepts reports on agent messages", async () => {
    const me = await register(h);
    const id = await startConversation(me);
    const { events } = await ask(me, id, "hello");
    const done = events.at(-1);
    if (done?.type !== "done") throw new Error("no answer");
    const report = { reason: "other", details: "Said something odd" };
    expect((await call(h, "POST", `/market/messages/${done.messageId}/report`, { as: me, body: report })).statusCode).toBe(204);
    expect((await call(h, "POST", `/market/messages/${done.messageId}/report`, { as: me, body: report })).statusCode).toBe(204);
    const stranger = await register(h);
    expect((await call(h, "POST", `/market/messages/${done.messageId}/report`, { as: stranger, body: report })).statusCode).toBe(404);

    expect((await call(h, "DELETE", `/market/conversations/${id}`, { as: me })).statusCode).toBe(204);
    expect((await call(h, "GET", `/market/conversations/${id}/messages`, { as: me })).statusCode).toBe(404);
    expect((await call(h, "GET", "/market/conversations", { as: me })).data.items).toEqual([]);
  });
});

describe("AI service outage", () => {
  it("answers 503 instead of hanging", async () => {
    const down = await createHarness();
    try {
      const me = await register(down);
      const shop = await call(down, "GET", "/market/shops/code-corner", { as: me });
      const conv = await call(down, "POST", `/market/agents/${shop.data.agent.id}/conversations`, { as: me });
      const res = await call(down, "POST", `/market/conversations/${conv.data.id}/messages`, { as: me, body: { content: "hi", clientMessageId: crypto.randomUUID() } });
      expect(res.statusCode).toBe(503);
      expect(res.data.error.code).toBe("ai_unavailable");
      expect((await call(down, "GET", "/market/usage/me", { as: me })).statusCode).toBe(503);
    } finally {
      await down.close();
    }
  });
});
