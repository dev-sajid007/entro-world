import { useCallback, useEffect, useRef, useState } from "react";
import type { SimEvent } from "@entroworld/puzzle-engine";
import { MAX_ACTION_LOG, type LessonAttemptResponse, type LessonView, type SessionJoinResponse, type SessionKind, type TrackView } from "@entroworld/robot-api";
import { errorMessage } from "../../lib/api";
import { labStore } from "../../game/academy/labStore";
import { PanelHeader } from "../world/Hud";
import { BlockEditor, type BlockEditorHandle } from "./editor/BlockEditor";
import { runProgram } from "./sandbox/runProgram";
import type { ExecuteResult } from "./sandbox/execute";
import { joinSession, saveDraft, submitAttempt, useAcademyBadges, useAcademyProgress, useLesson, useTracks } from "./hooks";
import { LeaderboardScreen } from "./social/Leaderboard";
import { SessionInvites, SessionSetup } from "./social/SessionSetup";
import { SessionScreen, currentSession, forgetSession } from "./social/SessionScreen";
import styles from "./Academy.module.css";

type View =
  | { kind: "home" }
  | { kind: "lesson"; id: string }
  | { kind: "leaderboard" }
  | { kind: "setup"; mode: SessionKind }
  | { kind: "session"; join: SessionJoinResponse };

/**
 * The Puzzle Lab console (SPEC-ADDENDUM-01 Milestones A1 and A3): pick a lesson, program the robot,
 * run it; or code with a friend (pair programming, battles) and check the weekly leaderboard.
 */
export default function AcademyPanel({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<View>({ kind: "home" });
  const home = () => setView({ kind: "home" });
  const openSession = (join: SessionJoinResponse) => setView({ kind: "session", join });
  switch (view.kind) {
    case "lesson":
      return <LessonScreen key={view.id} lessonId={view.id} onBack={home} onOpen={(id) => setView({ kind: "lesson", id })} onClose={onClose} />;
    case "leaderboard":
      return <LeaderboardScreen onBack={home} onClose={onClose} />;
    case "setup":
      return <SessionSetup initialKind={view.mode} onStarted={openSession} onBack={home} onClose={onClose} />;
    case "session":
      return <SessionScreen key={view.join.session.id} join={view.join} onExit={home} onClose={onClose} />;
    case "home":
      return (
        <TrackHome
          onOpen={(id) => setView({ kind: "lesson", id })}
          onLeaderboard={() => setView({ kind: "leaderboard" })}
          onSetup={(mode) => setView({ kind: "setup", mode })}
          onSession={openSession}
          onClose={onClose}
        />
      );
  }
}

// -------------------------------------------------------------------------------------------------
// Track overview
// -------------------------------------------------------------------------------------------------

function TrackHome({
  onOpen,
  onLeaderboard,
  onSetup,
  onSession,
  onClose,
}: {
  onOpen: (id: string) => void;
  onLeaderboard: () => void;
  onSetup: (mode: SessionKind) => void;
  onSession: (join: SessionJoinResponse) => void;
  onClose: () => void;
}) {
  const tracks = useTracks();
  const [rejoinError, setRejoinError] = useState<string | null>(null);
  const active = currentSession();
  const rejoin = async () => {
    if (!active) return;
    setRejoinError(null);
    try {
      onSession(await joinSession(active.id));
    } catch (e) {
      forgetSession();
      setRejoinError(errorMessage(e));
    }
  };
  const progress = useAcademyProgress();
  const badges = useAcademyBadges();
  const stats = progress.data?.stats;

  return (
    <div className={styles.academy}>
      <PanelHeader title="Puzzle Lab" subtitle="Program your robot companion to solve puzzles on the board." onClose={onClose} />
      {stats && (
        <div className={styles.stats}>
          <div className={styles.level}>
            <span className={styles.levelBadge}>Lv {stats.level}</span>
            <div className={styles.xpBar} role="progressbar" aria-valuemin={0} aria-valuemax={stats.levelSpan} aria-valuenow={stats.levelXp} aria-label="XP in this level">
              <div style={{ width: `${Math.round((stats.levelXp / stats.levelSpan) * 100)}%` }} />
            </div>
            <span className={styles.muted}>
              {stats.levelXp} / {stats.levelSpan} XP
            </span>
          </div>
          <span className={styles.muted}>🔥 {stats.currentStreak}-day streak</span>
        </div>
      )}
      {badges.data && badges.data.length > 0 && (
        <div className={styles.badges}>
          {badges.data.map((b) => (
            <span key={b.slug} className={styles.badge} title={b.description}>
              🏅 {b.name}
            </span>
          ))}
        </div>
      )}
      <SessionInvites onJoined={onSession} />
      {active && (
        <div className={styles.invite}>
          <span className={styles.grow}>
            You're in a {active.kind === "pair" ? "pair session" : "coding battle"} on “{active.lesson.title}”.
          </span>
          <button className={styles.run} onClick={() => void rejoin()}>
            Return
          </button>
        </div>
      )}
      {rejoinError && <p className={styles.error}>{rejoinError}</p>}
      <div className={styles.socialActions}>
        <button className={styles.secondary} onClick={() => onSetup("pair")}>
          🤝 Pair up
        </button>
        <button className={styles.secondary} onClick={() => onSetup("battle")}>
          ⚔️ Battle a friend
        </button>
        <button className={styles.secondary} onClick={onLeaderboard}>
          🏆 Leaderboard
        </button>
      </div>
      {tracks.isPending && <p className={styles.muted}>Loading lessons…</p>}
      {tracks.error && <p className={styles.error}>{errorMessage(tracks.error)}</p>}
      {tracks.data?.length === 0 && <p className={styles.muted}>No lessons are open yet. Check back soon!</p>}
      {tracks.data?.map((t) => (
        <TrackLessons key={t.id} track={t} done={new Set(progress.data?.lessons.filter((l) => l.status === "completed").map((l) => l.lessonId))} onOpen={onOpen} />
      ))}
    </div>
  );
}

function TrackLessons({ track, done, onOpen }: { track: TrackView; done: ReadonlySet<string>; onOpen: (id: string) => void }) {
  return (
    <section>
      <h3 className={styles.trackTitle}>{track.title}</h3>
      <p className={styles.muted}>{track.description}</p>
      <ol className={styles.lessons}>
        {track.lessons.map((l, i) => {
          const completed = done.has(l.id);
          // Lessons open in order; each one teaches what the next builds on.
          const locked = i > 0 && !done.has(track.lessons[i - 1]!.id) && !completed;
          return (
            <li key={l.id}>
              <button className={styles.lesson} disabled={locked} onClick={() => onOpen(l.id)}>
                <span className={styles.lessonIndex} data-done={completed || undefined}>
                  {completed ? "✓" : locked ? "🔒" : i + 1}
                </span>
                <span className={styles.lessonText}>
                  <strong>{l.title}</strong>
                  <span className={styles.muted}>{l.concept}</span>
                </span>
                <span className={styles.xp}>{l.xpReward} XP</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// -------------------------------------------------------------------------------------------------
// One lesson
// -------------------------------------------------------------------------------------------------

type Outcome =
  | { kind: "message"; tone: "info" | "error"; text: string }
  | { kind: "result"; run: ExecuteResult; server: LessonAttemptResponse | null; serverError: string | null };

const DRAFT_SAVE_DELAY_MS = 1500;

function LessonScreen({ lessonId, onBack, onOpen, onClose }: { lessonId: string; onBack: () => void; onOpen: (id: string) => void; onClose: () => void }) {
  const lesson = useLesson(lessonId);
  const data = lesson.data;

  // Saving a draft updates the cached lesson but keeps its puzzle object, so the board isn't reset.
  const puzzle = data?.puzzle;
  useEffect(() => {
    if (puzzle) labStore.show(puzzle);
  }, [puzzle]);

  if (lesson.isPending) {
    return (
      <div className={styles.academy}>
        <PanelHeader title="Loading…" onClose={onClose} />
      </div>
    );
  }
  if (!data) {
    return (
      <div className={styles.academy}>
        <PanelHeader title="Puzzle Lab" onClose={onClose} />
        <p className={styles.error}>{errorMessage(lesson.error)}</p>
        <button className={styles.secondary} onClick={onBack}>
          ← All lessons
        </button>
      </div>
    );
  }
  return <LessonWorkspace lesson={data} onBack={onBack} onOpen={onOpen} onClose={onClose} />;
}

function LessonWorkspace({ lesson, onBack, onOpen, onClose }: { lesson: LessonView; onBack: () => void; onOpen: (id: string) => void; onClose: () => void }) {
  const editor = useRef<BlockEditorHandle>(null);
  const [blockCount, setBlockCount] = useState(0);
  const [hints, setHints] = useState(0);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [completed, setCompleted] = useState(lesson.progress?.status === "completed");
  const { puzzle, content } = lesson;

  // Drafts save shortly after the last edit, and when leaving the lesson.
  const lastSaved = useRef<string | null>(lesson.draft?.code ?? null);
  /** The workspace as of the last edit (the editor may already be gone when the lesson closes). */
  const pending = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const code = pending.current;
    if (!code || code === lastSaved.current) return;
    lastSaved.current = code;
    saveDraft(lesson.id, { code, editorMode: "blocks" }).catch(() => {
      lastSaved.current = null;
    });
  }, [lesson.id]);
  useEffect(() => {
    // Loading the workspace re-serializes it slightly differently; that alone is not an edit.
    const baseline = setTimeout(() => {
      lastSaved.current = editor.current?.serialize() ?? null;
    }, 100);
    return () => {
      clearTimeout(baseline);
      flush();
    };
  }, [flush]);
  const onChange = useCallback(
    (count: number) => {
      setBlockCount(count);
      pending.current = editor.current?.serialize() ?? pending.current;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, DRAFT_SAVE_DELAY_MS);
    },
    [flush],
  );

  const run = async () => {
    const code = editor.current?.code() ?? "";
    if (!code.trim()) {
      setOutcome({ kind: "message", tone: "info", text: "Snap some blocks under “when ▶ Run is pressed” first." });
      return;
    }
    setRunning(true);
    setOutcome(null);
    labStore.reset();
    flush();
    try {
      const r = await runProgram(code, puzzle);
      if (r.kind === "timeout") {
        setOutcome({ kind: "message", tone: "error", text: "Your program was stopped after 2 seconds. Is there a loop that never ends?" });
        return;
      }
      if (r.kind === "crashed") {
        setOutcome({ kind: "message", tone: "error", text: r.message });
        return;
      }
      // The server replays the action log to confirm the result; the robot animates meanwhile.
      const submit =
        r.actions.length > 0 && r.actions.length <= MAX_ACTION_LOG
          ? submitAttempt(lesson.id, { actions: r.actions, editorMode: "blocks" }).then(
              (server) => ({ server, serverError: null }),
              (e: unknown) => ({ server: null, serverError: errorMessage(e) }),
            )
          : Promise.resolve({ server: null, serverError: null });
      const [, verdict] = await Promise.all([labStore.play(r.events, r.success ? "success" : "failure"), submit]);
      if (verdict.server?.success) setCompleted(true);
      setOutcome({ kind: "result", run: r, ...verdict });
    } finally {
      setRunning(false);
    }
  };

  const reset = () => {
    labStore.reset();
    setOutcome(null);
  };

  return (
    <div className={styles.academy}>
      <div className={styles.lessonHeader}>
        <button className={styles.back} onClick={onBack} aria-label="All lessons">
          ←
        </button>
        <div className={styles.grow}>
          <PanelHeader title={lesson.title} subtitle={`${content.concept} · ${lesson.xpReward} XP${completed ? " · ✓ Solved" : ""}`} onClose={onClose} />
        </div>
      </div>

      <p className={styles.intro}>{content.intro}</p>
      <p className={styles.task}>
        <strong>Goal:</strong> {content.instructions}
      </p>
      {content.hints.length > 0 && (
        <div className={styles.hints}>
          {content.hints.slice(0, hints).map((h, i) => (
            <p key={i} className={styles.hint}>
              💡 {h}
            </p>
          ))}
          {hints < content.hints.length && (
            <button className={styles.link} onClick={() => setHints((n) => n + 1)}>
              {hints === 0 ? "Need a hint?" : "Another hint"}
            </button>
          )}
        </div>
      )}

      <BlockEditor ref={editor} puzzle={puzzle} initial={lesson.draft?.editorMode === "blocks" ? lesson.draft.code : null} onChange={onChange} />

      <div className={styles.toolbar}>
        <button className={styles.run} onClick={() => void run()} disabled={running}>
          {running ? "Running…" : "▶ Run"}
        </button>
        <button className={styles.secondary} onClick={reset} disabled={running}>
          Reset robot
        </button>
        <button
          className={styles.secondary}
          onClick={() => {
            editor.current?.clear();
            reset();
          }}
          disabled={running}
        >
          Clear blocks
        </button>
        <span className={styles.blockCount} data-over={(puzzle.maxBlocks !== null && blockCount > puzzle.maxBlocks) || undefined}>
          {blockCount}
          {puzzle.maxBlocks !== null ? ` / ${puzzle.maxBlocks}` : ""} blocks
        </span>
      </div>

      {outcome && <OutcomeView outcome={outcome} lesson={lesson} onNext={lesson.nextLessonId ? () => onOpen(lesson.nextLessonId!) : null} onBack={onBack} />}
    </div>
  );
}

function OutcomeView({ outcome, lesson, onNext, onBack }: { outcome: Outcome; lesson: LessonView; onNext: (() => void) | null; onBack: () => void }) {
  if (outcome.kind === "message") return <div className={outcome.tone === "error" ? styles.failure : styles.info}>{outcome.text}</div>;
  const { run, server, serverError } = outcome;
  const said = run.events.filter((e): e is Extract<SimEvent, { type: "say" }> => e.type === "say").map((e) => e.text);
  const speech = said.length > 0 && <p className={styles.muted}>🤖 says: {said.map((t) => `“${t}”`).join(" ")}</p>;

  if (run.success && server?.success) {
    const par = lesson.puzzle.par;
    return (
      <div className={styles.success}>
        <strong>🎉 Puzzle solved!</strong>
        {speech}
        <p>
          {server.firstCompletion ? `+${server.xpAwarded} XP` : "Solved again: XP is only awarded the first time."}
          {par !== null && run.actions.length <= par ? " · Perfect solution!" : par !== null ? ` · ${run.actions.length} moves (best is ${par})` : ""}
        </p>
        {server.badgesAwarded.length > 0 && <p>🏅 New badge{server.badgesAwarded.length > 1 ? "s" : ""}: {server.badgesAwarded.map(titleCase).join(", ")}</p>}
        <div className={styles.toolbar}>
          {onNext ? (
            <button className={styles.run} onClick={onNext}>
              Next lesson →
            </button>
          ) : (
            <button className={styles.run} onClick={onBack}>
              Back to lessons
            </button>
          )}
        </div>
      </div>
    );
  }
  if (run.success) {
    return (
      <div className={styles.failure}>
        The robot made it, but your result couldn't be saved{serverError ? `: ${serverError}` : "."} Try running it again.
      </div>
    );
  }
  return (
    <div className={styles.failure}>
      {failureText(run, lesson)}
      {speech}
    </div>
  );
}

function failureText(run: ExecuteResult, lesson: LessonView): string {
  if (run.error) return `Oops: ${run.error}`;
  switch (run.failureReason) {
    case "blocked": {
      const bump = [...run.events].reverse().find((e): e is Extract<SimEvent, { type: "blocked" }> => e.type === "blocked");
      if (bump?.cause === "gap") return "Splash! The robot can't drive over a gap.";
      if (bump?.cause === "edge") return "Careful! The robot tried to drive off the board.";
      return "Bonk! The robot drove into a wall. Check your turns and step counts.";
    }
    case "too_many_actions":
      return `Too many moves: this puzzle allows at most ${lesson.puzzle.maxActions}. Can a loop help?`;
    case "invalid_action":
      return "That block can't be used in this puzzle.";
    default: {
      if (lesson.puzzle.goal.collectAll && batteriesLeft(run, lesson) > 0) return "Some batteries are still on the board. Pick them all up!";
      return "The program finished, but the robot isn't on the glowing exit yet.";
    }
  }
}

function batteriesLeft(run: ExecuteResult, lesson: LessonView): number {
  let left = lesson.puzzle.tiles.join("").split("B").length - 1;
  for (const e of run.events) {
    if (e.type === "pickUp" && e.ok) left--;
    if (e.type === "drop" && e.ok) left++;
  }
  return left;
}

const titleCase = (slug: string) => slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
