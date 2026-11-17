import type { AiEffort } from "@entroworld/config";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ProviderRequest {
  model: string;
  maxTokens: number;
  effort: AiEffort;
  /** Stable system prompt (kept identical across requests so the prompt prefix can be cached). */
  system: string;
  /** Alternating history ending with the new user message. */
  messages: ChatTurn[];
  signal: AbortSignal;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ProviderResult {
  text: string;
  /** `refusal`: the model or a safety classifier declined; any partial text must be discarded. */
  stopReason: "end_turn" | "max_tokens" | "refusal" | "other";
  usage: ProviderUsage;
  /** The model that produced the final answer (differs from the requested one after a fallback). */
  model: string;
}

/** Why a provider call failed, in terms the caller can act on. */
export class ProviderError extends Error {
  constructor(
    readonly kind: "aborted" | "overloaded" | "misconfigured" | "failed",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Swappable LLM backend (SPEC-ADDENDUM-01 §10.2 "LLM Provider Adapter"). */
export interface LlmProvider {
  readonly name: string;
  /** Streams the answer, calling `onText` for each text fragment, and resolves with the final result. */
  stream(request: ProviderRequest, onText: (text: string) => void): Promise<ProviderResult>;
}
