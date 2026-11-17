import styles from "./Voice.module.css";
import { useVoiceManager, useVoiceState } from "./VoiceContext";

/** HUD buttons for proximity voice: join/leave nearby voice and mute the microphone. */
export function VoiceControls() {
  const voice = useVoiceManager();
  const state = useVoiceState(voice);
  if (!voice || !state.available) return null;
  const on = state.proximity !== "off";
  const inCall = state.call !== null;
  return (
    <div className={styles.controls} role="group" aria-label="Voice">
      <button
        className={styles.control}
        data-on={on || undefined}
        disabled={inCall}
        onClick={() => void voice.toggleProximity()}
        title={inCall ? "Paused during your call" : on ? "Leave nearby voice (V)" : "Talk to people nearby (V)"}
      >
        <span aria-hidden>{state.proximity === "connecting" ? "⏳" : "🎙️"}</span>
        <span className={styles.controlLabel}>{inCall ? "In call" : on ? "Voice on" : "Voice"}</span>
      </button>
      {on && (
        <button className={styles.control} data-warn={state.muted || undefined} onClick={() => void voice.setMuted(!state.muted)} aria-pressed={state.muted}>
          <span aria-hidden>{state.muted ? "🔇" : "🔊"}</span>
          <span className={styles.controlLabel}>{state.muted ? "Muted" : "Mute"}</span>
        </button>
      )}
    </div>
  );
}
