import { ProviderError, type LlmProvider, type ProviderRequest, type ProviderResult } from "./types";

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Offline stand-in for development without an API key: answers honestly that it is a demo,
 * streamed word by word so the UI and NPC animations behave like the real thing.
 */
export class MockProvider implements LlmProvider {
  readonly name = "mock";

  constructor(private readonly delayMs = 35) {}

  async stream(request: ProviderRequest, onText: (text: string) => void): Promise<ProviderResult> {
    const last = request.messages.at(-1)?.content ?? "";
    const name = /Your name is ([^,.\n]+)/.exec(request.system)?.[1] ?? /You are ([^,.\n]+)/.exec(request.system)?.[1] ?? "the shopkeeper";
    const quoted = last.length > 120 ? `${last.slice(0, 117)}…` : last;
    const text =
      `Hi, ${name} here, running in offline demo mode, so I can't really think right now. ` +
      `You said: “${quoted}”. Ask the server admin to set AI_PROVIDER_API_KEY to connect me to Claude, and I'll give you a proper answer.`;
    const words = text.split(/(?<= )/);
    for (const word of words) {
      if (request.signal.aborted) throw new ProviderError("aborted", "Request aborted");
      await new Promise((r) => setTimeout(r, this.delayMs));
      onText(word);
    }
    const input = estimateTokens(request.system) + request.messages.reduce((n, m) => n + estimateTokens(m.content), 0);
    return { text, stopReason: "end_turn", usage: { inputTokens: input, outputTokens: estimateTokens(text) }, model: "mock" };
  }
}
