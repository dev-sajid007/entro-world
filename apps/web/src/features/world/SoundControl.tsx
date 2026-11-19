import { useEffect, useSyncExternalStore } from "react";
import { sfx } from "../../game/audio/Sfx";
import styles from "./Hud.module.css";

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Mute button and volume slider for the game's sounds (M toggles mute). Remembered per browser. */
export function SoundControl() {
  const { muted, volume } = useSyncExternalStore(sfx.subscribe, sfx.getSnapshot);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyM" && !e.repeat && !isTyping(e.target) && !e.ctrlKey && !e.metaKey) sfx.setMuted(!sfx.muted);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const icon = muted || volume === 0 ? "🔇" : volume < 0.4 ? "🔈" : volume < 0.75 ? "🔉" : "🔊";
  return (
    <div className={styles.sound}>
      <button className={styles.soundButton} onClick={() => sfx.setMuted(!muted)} aria-label={muted ? "Unmute sounds" : "Mute sounds"} title={muted ? "Unmute (M)" : "Mute (M)"}>
        {icon}
      </button>
      <input
        className={styles.soundSlider}
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        aria-label="Sound volume"
        onChange={(e) => sfx.setVolume(Number(e.target.value))}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </div>
  );
}
