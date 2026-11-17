import { describe, expect, it } from "vitest";
import { agentMessageRequestSchema, cleanAgentText } from "./messages";
import { SseDecoder, encodeSse } from "./stream";

describe("SSE stream", () => {
  it("decodes events split across arbitrary chunks", () => {
    const wire =
      encodeSse({ type: "animation", state: "thinking" }) +
      encodeSse({ type: "delta", text: "Hello\nthere" }) +
      encodeSse({ type: "done", messageId: "6f1c1f62-37a6-4d4b-9a3f-0d2b3b1e4a11", usage: { remaining: 3 } });
    const decoder = new SseDecoder();
    const events = [];
    for (let i = 0; i < wire.length; i += 7) events.push(...decoder.push(wire.slice(i, i + 7)));
    expect(events.map((e) => e.type)).toEqual(["animation", "delta", "done"]);
    expect(events[1]).toEqual({ type: "delta", text: "Hello\nthere" });
  });

  it("skips malformed and unknown frames", () => {
    const decoder = new SseDecoder();
    expect(decoder.push('data: {"type":"nope"}\n\ndata: not json\n\n: comment\n\n')).toEqual([]);
    expect(decoder.push(encodeSse({ type: "error", code: "blocked" }))).toEqual([{ type: "error", code: "blocked" }]);
  });
});

describe("message requests", () => {
  it("cleans invisible characters and enforces the length limit", () => {
    expect(cleanAgentText(" hi‮there​ ")).toBe("hithere");
    const ok = agentMessageRequestSchema.safeParse({ content: "  hello ", clientMessageId: "6f1c1f62-37a6-4d4b-9a3f-0d2b3b1e4a11" });
    expect(ok.success && ok.data.content).toBe("hello");
    expect(agentMessageRequestSchema.safeParse({ content: "​", clientMessageId: "6f1c1f62-37a6-4d4b-9a3f-0d2b3b1e4a11" }).success).toBe(false);
    expect(agentMessageRequestSchema.safeParse({ content: "x".repeat(2001), clientMessageId: "6f1c1f62-37a6-4d4b-9a3f-0d2b3b1e4a11" }).success).toBe(false);
  });
});
