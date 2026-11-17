import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SseDecoder,
  type AgentConversationView,
  type AgentMessageView,
  type AgentStreamErrorCode,
  type AiUsageView,
  type ShopDetailView,
} from "@entroworld/agent-protocol";
import type { Paginated } from "@entroworld/shared";
import { ApiError, api, errorMessage } from "../../lib/api";

export const marketKeys = {
  shop: (slug: string) => ["market", "shop", slug] as const,
  usage: ["market", "usage"] as const,
};

export const shopQuery = (slug: string) => ({
  queryKey: marketKeys.shop(slug),
  queryFn: () => api.get<ShopDetailView>(`/market/shops/${encodeURIComponent(slug)}`),
  staleTime: 5 * 60_000,
});

export const useShop = (slug: string) => useQuery(shopQuery(slug));

export const useAiUsage = () =>
  useQuery({ queryKey: marketKeys.usage, queryFn: () => api.get<AiUsageView>("/market/usage/me"), staleTime: 30_000, retry: false });

export interface ChatLine {
  /** Server id, or a local id while sending/streaming. */
  id: string;
  role: "user" | "agent" | "notice";
  text: string | null;
  /** Saved by the server (can be reported). */
  saved: boolean;
  /** The answer is still streaming in. */
  streaming?: boolean;
  noticeKind?: AgentStreamErrorCode | "error";
}

export type AgentActivity = "idle" | "thinking" | "talking";

const HISTORY_PAGE = 40;

const toLine = (m: AgentMessageView): ChatLine => ({
  id: m.id,
  role: m.senderType === "user" ? "user" : "agent",
  text: m.content,
  saved: true,
});

/**
 * One visitor's conversation with a shopkeeper: resumes the latest conversation, sends messages
 * and streams answers in. Leaving (unmount) stops an answer that is still being written.
 */
export function useAgentChat(agentId: string | undefined) {
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState<AgentActivity>("idle");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const list = await api.get<Paginated<AgentConversationView>>(`/market/conversations?agentId=${agentId}&limit=1`);
        const latest = list.items[0];
        if (!latest || cancelled) return;
        const page = await api.get<Paginated<AgentMessageView>>(`/market/conversations/${latest.id}/messages?limit=${HISTORY_PAGE}`);
        if (cancelled) return;
        setConversationId(latest.id);
        setLines(page.items.slice().reverse().map(toLine));
      } catch {
        // Starting fresh is fine if history can't be loaded.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [agentId]);

  const update = (id: string, patch: Partial<ChatLine>) => setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const notice = (text: string, kind: ChatLine["noticeKind"]) =>
    setLines((ls) => [...ls, { id: crypto.randomUUID(), role: "notice", text, saved: false, noticeKind: kind }]);

  const send = useCallback(
    async (content: string) => {
      if (!agentId || busy) return;
      setBusy(true);
      const clientMessageId = crypto.randomUUID();
      const replyId = `reply-${clientMessageId}`;
      setLines((ls) => [...ls, { id: clientMessageId, role: "user", text: content, saved: false }]);
      const controller = new AbortController();
      abort.current = controller;
      try {
        let id = conversationId;
        if (!id) {
          const created = await api.post<AgentConversationView>(`/market/agents/${agentId}/conversations`);
          id = created.id;
          setConversationId(id);
        }
        setActivity("thinking");
        const body = await api.stream(`/market/conversations/${id}/messages`, { content, clientMessageId }, controller.signal);
        const reader = body.getReader();
        const utf8 = new TextDecoder();
        const decoder = new SseDecoder();
        let text = "";
        let started = false;
        let finished = false;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          for (const event of decoder.push(utf8.decode(value, { stream: true }))) {
            if (event.type === "animation") setActivity(event.state === "idle" ? "idle" : event.state);
            else if (event.type === "delta") {
              text += event.text;
              if (!started) {
                started = true;
                setLines((ls) => [...ls, { id: replyId, role: "agent", text, saved: false, streaming: true }]);
              } else update(replyId, { text });
            } else if (event.type === "done") {
              finished = true;
              update(replyId, { id: event.messageId, streaming: false, saved: true });
              update(clientMessageId, { saved: true });
              queryClient.setQueryData<AiUsageView>(marketKeys.usage, (u) => (u ? { ...u, requests: { ...u.requests, remaining: event.usage.remaining } } : u));
            } else if (event.type === "error") {
              finished = true;
              // A blocked or failed answer must not stay on screen as if it were real.
              setLines((ls) => ls.filter((l) => l.id !== replyId));
              notice(event.message ?? "Something went wrong. Please try again.", event.code);
              if (event.code === "quota_exceeded") void queryClient.invalidateQueries({ queryKey: marketKeys.usage });
            }
          }
        }
        if (!finished && !controller.signal.aborted) {
          update(replyId, { streaming: false });
          notice("The connection dropped before the answer finished.", "error");
        }
      } catch (e) {
        if (controller.signal.aborted) return;
        const busyConversation = e instanceof ApiError && e.code === "conversation_busy";
        notice(busyConversation ? "Still answering your last message, one moment." : errorMessage(e), "error");
      } finally {
        if (abort.current === controller) abort.current = null;
        setActivity("idle");
        setBusy(false);
      }
    },
    [agentId, busy, conversationId, queryClient],
  );

  const reset = useCallback(() => {
    abort.current?.abort();
    setConversationId(null);
    setLines([]);
  }, []);

  return { lines, loading, activity, busy, send, reset, hasConversation: conversationId !== null };
}

export async function reportAgentMessage(messageId: string, reason: string, details: string): Promise<void> {
  await api.post(`/market/messages/${messageId}/report`, { reason, details });
}
