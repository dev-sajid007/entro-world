import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AGENT_MESSAGE_MAX_LENGTH } from "@entroworld/agent-protocol";
import { REPORT_REASONS } from "@entroworld/validation";
import { errorMessage } from "../../lib/api";
import { PanelHeader } from "../world/Hud";
import { reportAgentMessage, useAgentChat, useAiUsage, useShop, type ChatLine } from "./hooks";
import styles from "./Shop.module.css";

/** Chat with an AI shopkeeper (SPEC-ADDENDUM-01 Milestone B1). Opened at the shop counter. */
export function ShopPanel({ shopSlug, onClose }: { shopSlug: string; onClose: () => void }) {
  const shop = useShop(shopSlug);
  const agent = shop.data?.agent ?? null;
  const usage = useAiUsage();
  const chat = useAgentChat(agent?.id);
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.lines, chat.activity]);

  useEffect(() => {
    if (agent) inputRef.current?.focus();
  }, [agent]);

  if (shop.isPending) {
    return (
      <div className={styles.shop}>
        <PanelHeader title="…" onClose={onClose} />
      </div>
    );
  }
  if (shop.error || !agent) {
    return (
      <div className={styles.shop}>
        <PanelHeader title={shop.data?.name ?? "Shop"} onClose={onClose} />
        <p className={styles.muted}>{shop.error ? errorMessage(shop.error) : "Nobody is behind the counter right now. Come back later!"}</p>
      </div>
    );
  }

  const remaining = usage.data?.requests.remaining;
  const outOfQuestions = remaining === 0;
  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || chat.busy) return;
    setDraft("");
    void chat.send(text);
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Typing must never move the avatar or trigger world shortcuts.
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) submit(e);
    if (e.key === "Escape") onClose();
  };

  return (
    <div className={styles.shop}>
      <PanelHeader title={shop.data.name} subtitle={agent.specialty} onClose={onClose} />
      <div className={styles.keeper}>
        <span className={styles.aiBadge}>AI</span>
        <span>
          <strong>{agent.name}</strong> is an AI shopkeeper. Answers can be wrong; don't share passwords or personal details.
          {agent.disclaimer ? ` ${agent.disclaimer}` : ""}
        </span>
      </div>

      <div ref={listRef} className={styles.messages} aria-live="polite">
        <Bubble line={{ id: "greeting", role: "agent", text: agent.greeting, saved: false }} name={agent.name} />
        {chat.loading && <p className={styles.muted}>Loading your conversation…</p>}
        {chat.lines.map((l) => (
          <Bubble key={l.id} line={l} name={agent.name} />
        ))}
        {chat.activity === "thinking" && (
          <div className={styles.thinking}>
            {agent.name} is thinking<span className={styles.dots} aria-hidden />
          </div>
        )}
      </div>

      <form className={styles.composer} onSubmit={submit}>
        <textarea
          ref={inputRef}
          className={styles.input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onKeyUp={(e) => e.stopPropagation()}
          maxLength={AGENT_MESSAGE_MAX_LENGTH}
          rows={2}
          placeholder={outOfQuestions ? "No free questions left today" : `Ask ${agent.name} about code…`}
          disabled={outOfQuestions}
          aria-label={`Message ${agent.name}`}
        />
        <button className={styles.send} type="submit" disabled={!draft.trim() || chat.busy || outOfQuestions}>
          {chat.busy ? "…" : "Send"}
        </button>
      </form>
      <div className={styles.footer}>
        <span>{remaining === undefined ? "" : `${remaining} free question${remaining === 1 ? "" : "s"} left today`}</span>
        {chat.hasConversation && (
          <button className={styles.link} onClick={chat.reset} disabled={chat.busy}>
            New conversation
          </button>
        )}
      </div>
    </div>
  );
}

function Bubble({ line, name }: { line: ChatLine; name: string }) {
  if (line.role === "notice") {
    return <div className={line.noticeKind === "quota_exceeded" ? styles.quota : styles.notice}>{line.text}</div>;
  }
  const mine = line.role === "user";
  return (
    <div className={mine ? styles.mine : styles.theirs}>
      {!mine && <div className={styles.author}>{name}</div>}
      <div className={styles.text}>
        {line.text ?? <em className={styles.muted}>This message was removed.</em>}
        {line.streaming && <span className={styles.cursor} aria-hidden />}
      </div>
      {!mine && line.saved && line.text !== null && <ReportButton messageId={line.id} />}
    </div>
  );
}

function ReportButton({ messageId }: { messageId: string }) {
  const [state, setState] = useState<"closed" | "open" | "sending" | "done">("closed");
  const [reason, setReason] = useState<string>("other");
  const [error, setError] = useState<string | null>(null);
  if (state === "done") return <div className={styles.reported}>Reported. Thanks for letting us know.</div>;
  if (state === "closed") {
    return (
      <button className={styles.report} onClick={() => setState("open")}>
        Report
      </button>
    );
  }
  const submit = async () => {
    setState("sending");
    try {
      await reportAgentMessage(messageId, reason, "");
      setState("done");
    } catch (e) {
      setError(errorMessage(e));
      setState("open");
    }
  };
  return (
    <div className={styles.reportForm}>
      <select className={styles.select} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
        {REPORT_REASONS.map((r) => (
          <option key={r} value={r}>
            {r.replace("_", " ")}
          </option>
        ))}
      </select>
      <button className={styles.link} onClick={() => void submit()} disabled={state === "sending"}>
        Send report
      </button>
      <button className={styles.link} onClick={() => setState("closed")}>
        Cancel
      </button>
      {error && <span className={styles.error}>{error}</span>}
    </div>
  );
}
