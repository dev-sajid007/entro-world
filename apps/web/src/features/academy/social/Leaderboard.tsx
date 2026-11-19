import { useState } from "react";
import type { LeaderboardEntry, LeaderboardScope } from "@entroworld/robot-api";
import { errorMessage } from "../../../lib/api";
import { PanelHeader } from "../../world/Hud";
import { useLeaderboard } from "../hooks";
import styles from "../Academy.module.css";

const MEDALS = ["🥇", "🥈", "🥉"];

/** Weekly XP leaderboard: friends (default) or everyone. Resets Monday 00:00 UTC. */
export function LeaderboardScreen({ onBack, onClose }: { onBack: () => void; onClose: () => void }) {
  const [scope, setScope] = useState<LeaderboardScope>("friends");
  const board = useLeaderboard(scope);
  const data = board.data;
  const meShown = data?.me && data.entries.some((e) => e.user.id === data.me!.user.id);

  return (
    <div className={styles.academy}>
      <div className={styles.lessonHeader}>
        <button className={styles.back} onClick={onBack} aria-label="Back">
          ←
        </button>
        <div className={styles.grow}>
          <PanelHeader title="Weekly leaderboard" subtitle={data ? `XP earned since ${weekLabel(data.weekStart)} · resets ${resetsIn(data.weekEnd)}` : "XP earned this week"} onClose={onClose} />
        </div>
      </div>
      <div className={styles.tabs} role="tablist">
        {(["friends", "global"] as const).map((s) => (
          <button key={s} role="tab" aria-selected={scope === s} className={styles.tab} data-active={scope === s || undefined} onClick={() => setScope(s)}>
            {s === "friends" ? "Friends" : "Everyone"}
          </button>
        ))}
      </div>
      {board.isPending && <p className={styles.muted}>Loading…</p>}
      {board.error && <p className={styles.error}>{errorMessage(board.error)}</p>}
      {data && data.entries.length === 0 && (
        <p className={styles.muted}>{scope === "friends" ? "No XP from you or your friends yet this week. Solve a puzzle to get on the board!" : "Nobody has earned XP yet this week. Be the first!"}</p>
      )}
      {data && data.entries.length > 0 && (
        <ol className={styles.board}>
          {data.entries.map((e) => (
            <Row key={e.user.id} entry={e} me={e.user.id === data.me?.user.id} />
          ))}
          {data.me && !meShown && (
            <>
              <li className={styles.boardGap} aria-hidden>
                ⋯
              </li>
              <Row entry={data.me} me />
            </>
          )}
        </ol>
      )}
    </div>
  );
}

function Row({ entry, me }: { entry: LeaderboardEntry; me: boolean }) {
  return (
    <li className={styles.boardRow} data-me={me || undefined}>
      <span className={styles.boardRank}>{MEDALS[entry.rank - 1] ?? entry.rank}</span>
      <span className={styles.grow}>
        <strong>{entry.user.displayName}</strong>
        {me && " (you)"}
        <span className={styles.muted}> · Lv {entry.level}</span>
      </span>
      <span className={styles.xp}>{entry.weeklyXp} XP</span>
    </li>
  );
}

const weekLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

function resetsIn(iso: string): string {
  const hours = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 3_600_000));
  return hours >= 48 ? `in ${Math.round(hours / 24)} days` : hours >= 1 ? `in ${hours} h` : "soon";
}
