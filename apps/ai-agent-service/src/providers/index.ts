import { resolveAiProvider, type AiEnv } from "@entroworld/config";
import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";
import type { LlmProvider } from "./types";

export * from "./types";
export { AnthropicProvider } from "./anthropic";
export { MockProvider } from "./mock";

export function createProvider(env: AiEnv): LlmProvider {
  const provider = resolveAiProvider(env);
  if (provider === "mock") {
    if (env.NODE_ENV === "production") throw new Error("The mock AI provider is for development; set AI_PROVIDER=anthropic and an API key");
    return new MockProvider();
  }
  return new AnthropicProvider({ apiKey: env.AI_PROVIDER_API_KEY });
}
