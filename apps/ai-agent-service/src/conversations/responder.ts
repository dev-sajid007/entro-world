import type { AgentStreamEvent } from "@entroworld/agent-protocol";
import type { AiEffort } from "@entroworld/config";
import { buildSystemPrompt } from "../agents/prompt";
import type { AgentRecord, AgentRegistry } from "../agents/registry";
import type { NpcPublisher } from "../npc/publisher";
import { ProviderError, type LlmProvider, type ProviderUsage } from "../providers/types";
import { ABUSE_MESSAGE, DEFLECTIONS, moderateInput, moderateOutput, type ModerationVerdict } from "../safety/moderation";
import { OutputGuard } from "../safety/output-guard";
import type { QuotaService } from "../usage/quota";
import type { ConversationRef, ConversationStore, StoredMessage } from "./store";

export interface TurnInput {
  conversationId: string;
  userId: string;
  content: string;
  clientMessageId: string;
}

export type EventSink = (event: AgentStreamEvent) => void;

export interface ResponderDeps {
  store: ConversationStore;
  registry: AgentRegistry;
  provider: LlmProvider;
  quota: QuotaService;
  npc: NpcPublisher;
  moderationEnabled: boolean;
  /** Keys the per-agent prompt canary. */
  canarySecret: string;
  defaults: { model: string; effort: AiEffort; maxTokens: number };
  log: { warn: (obj: object, msg: string) => void; error: (obj: object, msg: string) => void; info: (obj: object, msg: string) => void };
}

export type Prepared = { ok: true; turn: Turn } | { ok: false; status: number; code: string; message: string };

const QUOTA_MESSAGE = "You've used all of today's free questions. Come back tomorrow and we'll pick up where we left off!";
const BLOCKED_REPLY = "Sorry, I can't help with that one. Is there something else I can do for you?";
const UNAVAILABLE = "I'm having trouble thinking right now. Please try again in a moment.";

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Answers one user message: checks access and idempotency up front (so failures can still be
 * plain HTTP errors), then streams the reply through moderation, quotas, the model and the leak
 * guard while driving the shopkeeper's animation.
 */
export class Responder {
  constructor(private readonly deps: ResponderDeps) {}

  async prepare(input: TurnInput): Promise<Prepared> {
    const { store, registry } = this.deps;
    const conversation = await store.access(input.conversationId, input.userId);
    if (!conversation) return { ok: false, status: 404, code: "not_found", message: "Conversation not found" };
    const agent = await registry.get(conversation.agentId);
    if (!agent) return { ok: false, status: 404, code: "not_found", message: "Conversation not found" };

    const existing = await store.findUserMessage(conversation.id, input.clientMessageId);
    if (existing) {
      const reply = await store.findReply(existing.id);
      if (reply) return { ok: true, turn: new ReplayTurn(this.deps, input, reply) };
    }
    const release = await store.lock(conversation.id);
    if (!release) {
      return { ok: false, status: 409, code: "conversation_busy", message: `${agent.name} is still answering your last message.` };
    }
    return { ok: true, turn: new LiveTurn(this.deps, input, conversation, agent, existing, release) };
  }
}

export interface Turn {
  run(sink: EventSink, signal: AbortSignal): Promise<void>;
}

/** A retried message that was already answered: send the stored answer again. */
class ReplayTurn implements Turn {
  constructor(
    private readonly deps: ResponderDeps,
    private readonly input: TurnInput,
    private readonly reply: StoredMessage,
  ) {}

  async run(sink: EventSink): Promise<void> {
    if (this.reply.moderationStatus === "blocked") {
      sink({ type: "error", code: "blocked", message: BLOCKED_REPLY });
      return;
    }
    sink({ type: "delta", text: this.reply.content });
    const usage = await this.deps.quota.usage(this.input.userId);
    sink({ type: "done", messageId: this.reply.id, usage: { remaining: usage.requests.remaining } });
  }
}

class LiveTurn implements Turn {
  private animating = false;

  constructor(
    private readonly deps: ResponderDeps,
    private readonly input: TurnInput,
    private readonly conversation: ConversationRef,
    private readonly agent: AgentRecord,
    private readonly existing: StoredMessage | null,
    private readonly release: () => Promise<void>,
  ) {}

  async run(sink: EventSink, signal: AbortSignal): Promise<void> {
    try {
      await this.answer(sink, signal);
    } finally {
      if (this.animating) this.deps.npc.publish(this.agent.id, this.conversation.id, "idle");
      await this.release().catch(() => undefined);
    }
  }

  private animate(sink: EventSink, state: "thinking" | "talking"): void {
    this.animating = true;
    this.deps.npc.publish(this.agent.id, this.conversation.id, state);
    sink({ type: "animation", state });
  }

  private async answer(sink: EventSink, signal: AbortSignal): Promise<void> {
    const { store, quota, provider, defaults, log } = this.deps;
    const { agent, conversation, input } = this;
    if (!this.agent.available) {
      sink({ type: "error", code: "unavailable", message: `${agent.shopName} is closed right now.` });
      return;
    }

    const verdict: ModerationVerdict = this.existing
      ? this.existing.moderationStatus === "ok"
        ? { status: "ok" }
        : moderateInput(this.existing.content)
      : this.deps.moderationEnabled
        ? moderateInput(input.content)
        : { status: "ok" };
    const userMessageId = this.existing?.id ?? (await store.addUserMessage(conversation, input.userId, input.content, input.clientMessageId, verdict.status));
    if (verdict.status === "blocked") {
      log.info({ conversationId: conversation.id, kind: verdict.kind }, "input blocked");
      sink({ type: "error", code: "blocked", message: ABUSE_MESSAGE });
      return;
    }

    const reservation = await quota.reserve(input.userId);
    if (!reservation.ok) {
      sink({ type: "error", code: "quota_exceeded", message: agent.persona.quotaMessage ?? QUOTA_MESSAGE });
      return;
    }
    this.animate(sink, "thinking");

    if (verdict.status === "flagged") {
      // Obvious injection attempt: answer in character without involving the model.
      log.info({ conversationId: conversation.id, kind: verdict.kind }, "injection attempt deflected");
      const text = DEFLECTIONS[verdict.kind];
      this.animate(sink, "talking");
      sink({ type: "delta", text });
      const messageId = await store.addAgentMessage(conversation, { content: text, tokenCount: 0, status: "flagged", replyToId: userMessageId });
      await this.finishUsage(reservation.day, { inputTokens: 0, outputTokens: 0 });
      const remaining = await quota.addTokens(input.userId, reservation.day, 0);
      sink({ type: "done", messageId, usage: { remaining } });
      return;
    }

    const prompt = buildSystemPrompt(agent, this.deps.canarySecret);
    const history = await store.history(conversation.id, userMessageId);
    const guard = new OutputGuard(prompt.system, prompt.canary);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    let streamed = "";
    try {
      const result = await provider.stream(
        {
          model: agent.modelConfig.model ?? defaults.model,
          maxTokens: agent.modelConfig.maxTokens ?? defaults.maxTokens,
          effort: agent.modelConfig.effort ?? defaults.effort,
          system: prompt.system,
          messages: [...history, { role: "user", content: input.content }],
          signal: controller.signal,
        },
        (text) => {
          if (!streamed) this.animate(sink, "talking");
          streamed += text;
          const safe = guard.push(text);
          if (safe) sink({ type: "delta", text: safe });
          if (guard.violation) controller.abort();
        },
      );

      if (result.stopReason === "refusal") {
        // Declined (possibly mid-answer): the partial text must not be kept as an answer.
        log.info({ conversationId: conversation.id, model: result.model }, "model refused");
        await this.blocked(sink, userMessageId, result.text, reservation.day, result.usage, BLOCKED_REPLY);
        return;
      }
      const rest = guard.finish(result.text);
      if (guard.violation || moderateOutput(result.text) === "blocked") {
        log.warn({ conversationId: conversation.id, agentId: agent.id }, "output blocked (possible prompt leak)");
        await this.blocked(sink, userMessageId, result.text, reservation.day, result.usage);
        return;
      }
      const text = result.text.trim() ? result.text + (result.stopReason === "max_tokens" ? "…" : "") : "";
      if (!text) throw new ProviderError("failed", "Empty answer");
      if (rest) sink({ type: "delta", text: rest });
      if (result.stopReason === "max_tokens") sink({ type: "delta", text: "…" });
      const messageId = await store.addAgentMessage(conversation, { content: text, tokenCount: result.usage.outputTokens, status: "ok", replyToId: userMessageId });
      await this.finishUsage(reservation.day, result.usage);
      const remaining = await quota.addTokens(input.userId, reservation.day, result.usage.inputTokens + result.usage.outputTokens);
      sink({ type: "done", messageId, usage: { remaining } });
    } catch (error) {
      const estimated = { inputTokens: estimateTokens(prompt.system) + history.reduce((n, t) => n + estimateTokens(t.content), 0), outputTokens: estimateTokens(streamed) };
      if (guard.violation) {
        log.warn({ conversationId: conversation.id, agentId: agent.id }, "output blocked mid-stream (possible prompt leak)");
        await this.blocked(sink, userMessageId, streamed, reservation.day, estimated);
        return;
      }
      if (signal.aborted) {
        // The visitor left mid-answer: keep what they saw so the conversation stays coherent.
        if (streamed.trim()) {
          await store.addAgentMessage(conversation, { content: `${streamed.trimEnd()}…`, tokenCount: estimated.outputTokens, status: "ok", replyToId: userMessageId });
        }
        await this.finishUsage(reservation.day, estimated);
        await quota.addTokens(input.userId, reservation.day, estimated.inputTokens + estimated.outputTokens);
        return;
      }
      const kind = error instanceof ProviderError ? error.kind : "failed";
      (kind === "misconfigured" ? log.error : log.warn)({ err: error, conversationId: conversation.id, provider: provider.name }, "agent reply failed");
      await quota.release(input.userId, reservation.day);
      sink({ type: "error", code: "unavailable", message: UNAVAILABLE });
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  private async blocked(sink: EventSink, replyToId: string, content: string, day: string, usage: ProviderUsage, message = BLOCKED_REPLY): Promise<void> {
    // Kept for moderators; never shown to users or sent back to the model.
    await this.deps.store.addAgentMessage(this.conversation, { content: content || "(empty)", tokenCount: usage.outputTokens, status: "blocked", replyToId });
    await this.finishUsage(day, usage);
    await this.deps.quota.addTokens(this.input.userId, day, usage.inputTokens + usage.outputTokens);
    sink({ type: "error", code: "blocked", message });
  }

  private async finishUsage(day: string, usage: ProviderUsage): Promise<void> {
    await this.deps.quota
      .record({ userId: this.input.userId, agentId: this.agent.id, productId: this.agent.chatProductId, day, ...usage })
      .catch((err) => this.deps.log.warn({ err }, "could not record usage"));
  }
}
