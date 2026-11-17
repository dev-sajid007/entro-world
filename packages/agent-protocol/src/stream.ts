import { z } from "zod";

/** What the shopkeeper NPC is doing while it handles a message. */
export const AGENT_ANIMATION_STATES = ["thinking", "talking", "idle"] as const;
export type AgentAnimationState = (typeof AGENT_ANIMATION_STATES)[number];

export const AGENT_STREAM_ERRORS = ["quota_exceeded", "blocked", "unavailable"] as const;
export type AgentStreamErrorCode = (typeof AGENT_STREAM_ERRORS)[number];

/**
 * Events streamed (as Server-Sent Events) while an agent answers. A reply is any number of
 * `delta`s followed by exactly one `done` or `error`.
 */
export const agentStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("animation"), state: z.enum(AGENT_ANIMATION_STATES) }),
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({
    type: z.literal("done"),
    messageId: z.uuid(),
    usage: z.object({ remaining: z.number().int().nonnegative() }),
  }),
  z.object({
    type: z.literal("error"),
    code: z.enum(AGENT_STREAM_ERRORS),
    /** A friendly, in-character explanation to show in the world. */
    message: z.string().optional(),
  }),
]);
export type AgentStreamEvent = z.infer<typeof agentStreamEventSchema>;

/** Encodes one event as an SSE frame. */
export const encodeSse = (event: AgentStreamEvent): string => `data: ${JSON.stringify(event)}\n\n`;

/**
 * Incremental SSE decoder: feed it text chunks as they arrive, get back the complete events.
 * Frames that are not valid agent events are skipped.
 */
export class SseDecoder {
  private buffer = "";

  push(chunk: string): AgentStreamEvent[] {
    this.buffer += chunk.replace(/\r\n?/g, "\n");
    const events: AgentStreamEvent[] = [];
    let end: number;
    while ((end = this.buffer.indexOf("\n\n")) >= 0) {
      const frame = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const data = frame
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      try {
        const parsed = agentStreamEventSchema.safeParse(JSON.parse(data));
        if (parsed.success) events.push(parsed.data);
      } catch {
        // Ignore malformed frames.
      }
    }
    return events;
  }
}
