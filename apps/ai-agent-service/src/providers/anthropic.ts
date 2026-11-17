import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, type LlmProvider, type ProviderRequest, type ProviderResult, type ProviderUsage } from "./types";

/**
 * Claude via the official Anthropic SDK. Requests stream, enable automatic prompt caching (the
 * system prompt and earlier turns form a stable prefix) and opt into server-side refusal
 * fallbacks, so a safety-classifier decline is retried on a fallback model inside the same call.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private readonly client: Anthropic;

  constructor(options: { apiKey?: string | undefined } = {}) {
    // Without an explicit key the SDK resolves credentials itself (ANTHROPIC_API_KEY, ...).
    this.client = new Anthropic({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), maxRetries: 2, timeout: 60_000 });
  }

  async stream(request: ProviderRequest, onText: (text: string) => void): Promise<ProviderResult> {
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          system: [{ type: "text", text: request.system }],
          messages: request.messages,
          // Thinking stays adaptive (the model default); effort trades depth for latency.
          output_config: { effort: request.effort },
          cache_control: { type: "ephemeral" },
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal: request.signal },
      );
      stream.on("text", (delta) => onText(delta));
      const message = await stream.finalMessage();
      const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      const stop = message.stop_reason;
      return {
        text,
        stopReason: stop === "end_turn" || stop === "max_tokens" || stop === "refusal" ? stop : "other",
        usage: totalUsage(message.usage),
        model: message.model,
      };
    } catch (error) {
      throw toProviderError(error);
    }
  }
}

/** Sums every sampling attempt (a refused attempt and its fallback are both billed). */
function totalUsage(usage: Anthropic.Beta.BetaUsage): ProviderUsage {
  const input = (u: { input_tokens: number; cache_creation_input_tokens?: number | null; cache_read_input_tokens?: number | null }) =>
    u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
  const attempts = (usage.iterations ?? []).filter((i) => i.type === "message" || i.type === "fallback_message");
  if (attempts.length > 0) {
    return {
      inputTokens: attempts.reduce((sum, i) => sum + input(i), 0),
      outputTokens: attempts.reduce((sum, i) => sum + i.output_tokens, 0),
    };
  }
  return { inputTokens: input(usage), outputTokens: usage.output_tokens };
}

function toProviderError(error: unknown): ProviderError {
  if (error instanceof Anthropic.APIUserAbortError) return new ProviderError("aborted", "Request aborted", { cause: error });
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new ProviderError("misconfigured", "The AI provider rejected the API key", { cause: error });
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new ProviderError("misconfigured", `The AI provider rejected the request: ${error.message}`, { cause: error });
  }
  if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.InternalServerError) {
    return new ProviderError("overloaded", "The AI provider is busy", { cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError) return new ProviderError("overloaded", "Could not reach the AI provider", { cause: error });
  if (error instanceof Anthropic.APIError) return new ProviderError("failed", `AI provider error ${error.status ?? ""}`.trim(), { cause: error });
  if (error instanceof Anthropic.AnthropicError && /api ?key|credential|auth/i.test(error.message)) {
    return new ProviderError("misconfigured", error.message, { cause: error });
  }
  return new ProviderError("failed", error instanceof Error ? error.message : "AI provider failed", { cause: error });
}
