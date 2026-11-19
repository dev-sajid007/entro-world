import { useState } from "react";
import type { SessionJoinResponse, SessionKind } from "@entroworld/robot-api";
import { errorMessage } from "../../../lib/api";
import { useFriends } from "../../social/hooks";
import { PanelHeader } from "../../world/Hud";
import { createSession, joinSession, leaveSession, useSessionInvites, useTracks } from "../hooks";
import styles from "../Academy.module.css";

export const KIND_LABEL: Record<SessionKind, string> = { pair: "pair programming", battle: "coding battle" };

/** Pick a mode, a friend and a puzzle, then invite them. */
export function SessionSetup({
  initialKind,
  onStarted,
  onBack,
  onClose,
}: {
  initialKind: SessionKind;
  onStarted: (join: SessionJoinResponse) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<SessionKind>(initialKind);
  const [friendId, setFriendId] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const friends = useFriends();
  const tracks = useTracks();
  // Online friends first: they can join right away.
  const sorted = [...(friends.data ?? [])].sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName));
  const lessons = tracks.data?.flatMap((t) => t.lessons) ?? [];

  const start = async () => {
    if (!friendId || !lessonId) return;
    setBusy(true);
    setError(null);
    try {
      onStarted(await createSession({ kind, friendId, lessonId }));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className={styles.academy}>
      <div className={styles.lessonHeader}>
        <button className={styles.back} onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className={styles.grow}>
          <PanelHeader title="Code with a friend" subtitle="Invite a friend to a session. They'll get a notification in the city." onClose={onClose} />
        </div>
      </div>

      <div className={styles.tabs} role="radiogroup" aria-label="Mode">
        {(["pair", "battle"] as const).map((k) => (
          <button key={k} role="radio" aria-checked={kind === k} className={styles.tab} data-active={kind === k || undefined} onClick={() => setKind(k)}>
            {k === "pair" ? "🤝 Pair programming" : "⚔️ Coding battle"}
          </button>
        ))}
      </div>
      <p className={styles.muted}>
        {kind === "pair"
          ? "You share one program. One of you drives (edits the blocks), the other watches and helps. Pass the keyboard any time."
          : "Same puzzle, separate programs. When you're both ready, a countdown starts the race. The first verified solve wins."}
      </p>

      <label className={styles.field}>
        <span>Friend</span>
        <select value={friendId} onChange={(e) => setFriendId(e.target.value)} disabled={busy}>
          <option value="">{friends.isPending ? "Loading friends…" : sorted.length === 0 ? "Add friends to play together" : "Choose a friend"}</option>
          {sorted.map((f) => (
            <option key={f.id} value={f.id}>
              {f.online ? "🟢" : "⚪"} {f.displayName} (@{f.username})
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>Puzzle</span>
        <select value={lessonId} onChange={(e) => setLessonId(e.target.value)} disabled={busy}>
          <option value="">Choose a puzzle</option>
          {lessons.map((l, i) => (
            <option key={l.id} value={l.id}>
              {i + 1}. {l.title}
            </option>
          ))}
        </select>
      </label>
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.toolbar}>
        <button className={styles.run} disabled={!friendId || !lessonId || busy} onClick={() => void start()}>
          {busy ? "Inviting…" : "Send invitation"}
        </button>
      </div>
    </div>
  );
}

/** Invitations from friends, shown on the Puzzle Lab home screen. */
export function SessionInvites({ onJoined }: { onJoined: (join: SessionJoinResponse) => void }) {
  const invites = useSessionInvites();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!invites.data || invites.data.length === 0) return null;

  const act = async (id: string, accept: boolean) => {
    setBusy(id);
    setError(null);
    try {
      if (accept) onJoined(await joinSession(id));
      else await leaveSession(id);
    } catch (e) {
      setError(errorMessage(e));
      void invites.refetch();
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className={styles.invites} aria-label="Invitations">
      {invites.data.map((s) => (
        <div key={s.id} className={styles.invite}>
          <span className={styles.grow}>
            {s.kind === "pair" ? "🤝" : "⚔️"} <strong>{s.host.displayName}</strong> invited you to {KIND_LABEL[s.kind]} on “{s.lesson.title}”
          </span>
          <button className={styles.run} disabled={busy !== null} onClick={() => void act(s.id, true)}>
            Join
          </button>
          <button className={styles.secondary} disabled={busy !== null} onClick={() => void act(s.id, false)}>
            Decline
          </button>
        </div>
      ))}
      {error && <p className={styles.error}>{error}</p>}
    </section>
  );
}
