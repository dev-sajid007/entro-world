import { useEffect, useState } from "react";
import { UserAvatar } from "../../components/ui";
import styles from "./Voice.module.css";
import { useVoiceManager, useVoiceState } from "./VoiceContext";

function useClock(since: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (since === null) return "";
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Incoming / outgoing / active call card, shown on every page while the world session runs. */
export function CallOverlay() {
  const voice = useVoiceManager();
  const state = useVoiceState(voice);
  const clock = useClock(state.call?.startedAt ?? null);
  if (!voice) return null;
  const call = state.call;

  return (
    <div className={styles.overlay} aria-live="polite">
      {state.audioBlocked && (state.call?.phase === "active" || state.proximity === "on") && (
        <button className={styles.unlock} onClick={() => void voice.unlockAudio()}>
          🔈 Tap to hear voices
        </button>
      )}
      {call && (
        <div className={styles.callCard} role={call.direction === "incoming" && call.phase === "ringing" ? "alertdialog" : "status"} aria-label="Voice call">
          <div className={call.phase === "ringing" ? styles.pulse : undefined}>
            <UserAvatar name={call.peer.displayName} url={call.peer.avatarUrl} />
          </div>
          <div className={styles.callInfo}>
            <strong>{call.peer.displayName}</strong>
            <span className={styles.callStatus}>
              {call.phase === "active"
                ? `On call · ${clock}`
                : call.phase === "connecting"
                  ? "Connecting…"
                  : call.direction === "incoming"
                    ? "Incoming voice call"
                    : "Calling…"}
            </span>
          </div>
          <div className={styles.callActions}>
            {call.direction === "incoming" && call.phase === "ringing" && (
              <button className={`${styles.round} ${styles.accept}`} onClick={() => void voice.accept()} aria-label="Accept call">
                📞
              </button>
            )}
            {call.phase === "active" && (
              <button className={styles.round} data-warn={state.muted || undefined} onClick={() => void voice.setMuted(!state.muted)} aria-label={state.muted ? "Unmute" : "Mute"} aria-pressed={state.muted}>
                {state.muted ? "🔇" : "🎙️"}
              </button>
            )}
            <button
              className={`${styles.round} ${styles.decline}`}
              onClick={() => void voice.hangUp()}
              aria-label={call.direction === "incoming" && call.phase === "ringing" ? "Decline call" : call.phase === "active" ? "Hang up" : "Cancel call"}
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {state.notice && <div className={styles.notice}>{state.notice}</div>}
    </div>
  );
}
