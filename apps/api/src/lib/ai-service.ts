import { INTERNAL_TOKEN_HEADER, type AiUsageView, type InternalAgentMessage, type InternalTutorRequest } from "@entroworld/agent-protocol";
import { internalServiceToken, type ApiEnv } from "@entroworld/config";

/** Client for the internal AI agent service. Only the API talks to it, after authenticating users. */
export class AiServiceClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(env: ApiEnv) {
    this.baseUrl = env.AI_SERVICE_URL.replace(/\/$/, "");
    this.token = internalServiceToken(env);
  }

  /** Starts an answer; the response is an SSE stream, or a JSON error before streaming began. */
  sendMessage(conversationId: string, body: InternalAgentMessage, signal: AbortSignal): Promise<Response> {
    return fetch(`${this.baseUrl}/internal/v1/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", [INTERNAL_TOKEN_HEADER]: this.token },
      body: JSON.stringify(body),
      signal,
    });
  }

  /** Starts an Academy tutor hint; an SSE stream like {@link sendMessage}. */
  tutorHint(body: InternalTutorRequest, signal: AbortSignal): Promise<Response> {
    return fetch(`${this.baseUrl}/internal/v1/tutor/hints`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", [INTERNAL_TOKEN_HEADER]: this.token },
      body: JSON.stringify(body),
      signal,
    });
  }

  async usage(userId: string): Promise<AiUsageView> {
    const res = await fetch(`${this.baseUrl}/internal/v1/usage/${userId}`, {
      headers: { [INTERNAL_TOKEN_HEADER]: this.token },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`AI service usage request failed with ${res.status}`);
    return (await res.json()) as AiUsageView;
  }
}
