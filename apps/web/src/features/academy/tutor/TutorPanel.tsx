import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SseDecoder, TUTOR_CODE_MAX_LENGTH, TUTOR_MAX_PREVIOUS_HINTS, TUTOR_QUESTION_MAX_LENGTH, type AiUsageView, type TutorHintRequest } from "@entroworld/agent-protocol";
import type { EditorMode } from "@entroworld/robot-api";
import { ApiError, api, errorMessage } from "../../../lib/api";
import { marketKeys, useAiUsage } from "../../market/hooks";
import styles from "../Academy.module.css";

type LastRun = NonNullable<TutorHintRequest["lastRun"]>;

interface Hint {
  id: string;
  question: string | null;
  text: string;
  streaming: boolean;
  tone: "hint" | "notice";
}

interface Props {
  lessonId: string;
  editorMode: EditorMode;
  /** The learner's program as JavaScript, read when they ask. */
  getCode: () => string;
  lastRun: LastRun | undefined;
}

const SHARE_KEY = "ew:academy:share-code";
const readShare = () => {
  try {
    return localStorage.getItem(SHARE_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * Byte the tutor, visiting from Code Corner (SPEC-ADDENDUM-01 §3.3): hints, not solutions. The
 * learner's program is only sent when they tick "share my program".
 */
export function TutorPanel({ lessonId, editorMode, getCode, lastRun }: Props) {
  const [open, setOpen] = useState(false);
  const [hints, setHints] = useState<Hint[]>([]);
  const [question, setQuestion] = useState("");
  const [share, setShare] = useState(readShare);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const usage = useAiUsage();
  const queryClient = useQueryClient();

  useEffect(() => () => abort.current?.abort(), []);

  const toggleShare = (value: boolean) => {
    setShare(value);
    try {
      localStorage.setItem(SHARE_KEY, value ? "1" : "0");
    } catch {
      // The choice just isn't remembered.
    }
  };

  const update = (id: string, patch: Partial<Hint>) => setHints((hs) => hs.map((h) => (h.id === id ? { ...h, ...patch } : h)));

  const ask = async () => {
    if (busy) return;
    const id = crypto.randomUUID();
    const asked = question.trim().slice(0, TUTOR_QUESTION_MAX_LENGTH);
    const previousHints = hints
      .filter((h) => h.tone === "hint" && !h.streaming && h.text)
      .slice(-TUTOR_MAX_PREVIOUS_HINTS)
      .map((h) => h.text.slice(0, 1200));
    const body: TutorHintRequest = { editorMode, previousHints };
    if (asked) body.question = asked;
    if (share) body.code = getCode().slice(0, TUTOR_CODE_MAX_LENGTH);
    if (lastRun) body.lastRun = lastRun;

    setBusy(true);
    setQuestion("");
    setHints((hs) => [...hs, { id, question: asked || null, text: "", streaming: true, tone: "hint" }]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const stream = await api.stream(`/academy/lessons/${encodeURIComponent(lessonId)}/tutor`, body, controller.signal);
      const reader = stream.getReader();
      const utf8 = new TextDecoder();
      const decoder = new SseDecoder();
      let text = "";
      let finished = false;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const event of decoder.push(utf8.decode(value, { stream: true }))) {
          if (event.type === "delta") {
            text += event.text;
            update(id, { text });
          } else if (event.type === "done") {
            finished = true;
            update(id, { streaming: false });
            queryClient.setQueryData<AiUsageView>(marketKeys.usage, (u) => (u ? { ...u, requests: { ...u.requests, remaining: event.usage.remaining } } : u));
          } else if (event.type === "error") {
            finished = true;
            // A blocked or failed answer must not stay on screen as if it were real.
            update(id, { text: event.message ?? "Something went wrong. Please try again.", streaming: false, tone: "notice" });
            if (event.code === "quota_exceeded") void queryClient.invalidateQueries({ queryKey: marketKeys.usage });
          }
        }
      }
      if (!finished && !controller.signal.aborted) update(id, { streaming: false, tone: "notice", text: "The connection dropped before Byte finished." });
    } catch (e) {
      if (controller.signal.aborted) return;
      const limited = e instanceof ApiError && e.status === 429;
      update(id, { streaming: false, tone: "notice", text: limited ? "Slow down a little! Try again in a minute." : errorMessage(e) });
    } finally {
      if (abort.current === controller) abort.current = null;
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className={styles.tutorOpen} onClick={() => setOpen(true)}>
        🤖 Ask Byte for a hint
      </button>
    );
  }

  const remaining = usage.data?.requests.remaining;
  return (
    <section className={styles.tutor} aria-label="Byte, AI tutor">
      <div className={styles.tutorHeader}>
        <strong>🤖 Byte</strong>
        <span className={styles.aiTag}>AI tutor</span>
        <span className={styles.grow} />
        {remaining !== undefined && <span className={styles.muted}>{remaining} questions left today</span>}
        <button
          className={styles.link}
          onClick={() => {
            abort.current?.abort();
            setOpen(false);
          }}
        >
          Close
        </button>
      </div>
      {hints.length === 0 && <p className={styles.muted}>Hi! I'm Byte from Code Corner. I give hints, not answers, so you still get to crack it yourself. Ask me anything about this puzzle.</p>}
      <div className={styles.tutorHints} aria-live="polite">
        {hints.map((h) => (
          <div key={h.id} className={styles.tutorHint} data-tone={h.tone}>
            {h.question && <p className={styles.tutorQuestion}>You: {h.question}</p>}
            <p>{h.text || (h.streaming ? "Byte is thinking…" : "")}</p>
          </div>
        ))}
      </div>
      <form
        className={styles.tutorForm}
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <input
          className={styles.tutorInput}
          value={question}
          maxLength={TUTOR_QUESTION_MAX_LENGTH}
          placeholder="Ask a question (optional)"
          aria-label="Question for Byte"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
        />
        <button className={styles.run} type="submit" disabled={busy || remaining === 0}>
          {busy ? "…" : hints.length === 0 ? "Get a hint" : "Ask"}
        </button>
      </form>
      <label className={styles.tutorShare}>
        <input type="checkbox" checked={share} onChange={(e) => toggleShare(e.target.checked)} />
        Share my program with Byte so the hint fits my code
      </label>
      <p className={styles.tutorNote}>Byte is an AI and can make mistakes. Don't share personal information.</p>
    </section>
  );
}
