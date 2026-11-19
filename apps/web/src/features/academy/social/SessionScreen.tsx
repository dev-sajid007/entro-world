import { useCallback, useEffect, useRef, useState } from "react";
import { replay } from "@entroworld/puzzle-engine";
import { CloseReason } from "@entroworld/game-protocol";
import {
  MAX_ACTION_LOG,
  type AcademySessionView,
  type LessonView,
  type RobotAction,
  type SessionJoinResponse,
  type SessionProgramPayload,
  type SessionStateView,
} from "@entroworld/robot-api";
import { errorMessage } from "../../../lib/api";
import { labStore } from "../../../game/academy/labStore";
import { useCurrentUser } from "../../auth/AuthContext";
import { PanelHeader } from "../../world/Hud";
import { BlockEditor, type BlockEditorHandle } from "../editor/BlockEditor";
import { submitAttempt, useLesson, leaveSession } from "../hooks";
import { runProgram } from "../sandbox/runProgram";
import { abortedSentence, failureSentence, type RunSummary } from "./runText";
import { KIND_LABEL } from "./SessionSetup";
import { SessionConnection } from "./SessionConnection";
import styles from "../Academy.module.css";

/**
 * The session this browser is in, so reopening the console offers a way back. Module state: it
 * lives as long as the page, like the world session.
 */
let activeSession: AcademySessionView | null = null;
export const currentSession = () => activeSession;
export const forgetSession = () => {
  activeSession = null;
};

type Status = "connecting" | "connected" | "reconnecting" | "closed";
type Notice = { tone: "info" | "error" | "success"; text: string } | null;

/** Edits are sent at most this often while the driver drags blocks around. */
const EDIT_THROTTLE_MS = 150;

/** Pair programming or a coding battle with a friend, in the Puzzle Lab. */
export function SessionScreen({ join, onExit, onClose }: { join: SessionJoinResponse; onExit: () => void; onClose: () => void }) {
  const me = useCurrentUser();
  const lesson = useLesson(join.session.lesson.id);
  const [connection, setConnection] = useState<SessionConnection | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [closedReason, setClosedReason] = useState<string | null>(null);
  const [state, setState] = useState<SessionStateView | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  /** The latest shared program, kept here because it can arrive before the pair view mounts. */
  const latestProgram = useRef<SessionProgramPayload | null>(null);

  useEffect(() => {
    activeSession = join.session;
    let conn: SessionConnection | null = null;
    let cancelled = false;
    SessionConnection.connect(join.gameServerUrl, join.session.id, join.ticket)
      .then((c) => {
        if (cancelled) {
          void c.leave();
          return;
        }
        conn = c;
        c.on("state", setState);
        c.on("program", (p) => {
          if (!latestProgram.current || p.version >= latestProgram.current.version) latestProgram.current = p;
        });
        c.on("error", (e) => setNotice({ tone: "error", text: e.message }));
        c.on("reconnecting", (r) => setStatus(r ? "reconnecting" : "connected"));
        c.on("closed", ({ code }) => {
          setStatus("closed");
          setClosedReason(code === CloseReason.DuplicateSession ? "You opened this session in another window." : "The connection to the session was lost.");
        });
        setConnection(c);
        setStatus("connected");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setStatus("closed");
        setClosedReason(errorMessage(e));
      });
    return () => {
      cancelled = true;
      void conn?.leave();
    };
  }, [join]);

  const puzzle = lesson.data?.puzzle;
  useEffect(() => {
    if (puzzle) labStore.show(puzzle);
  }, [puzzle]);

  const leave = async () => {
    forgetSession();
    await connection?.leave();
    // The host calls the session off; a guest just leaves (the host may invite them again).
    if (join.session.host.id === me.id) await leaveSession(join.session.id).catch(() => undefined);
    onExit();
  };

  const partner = join.session.host.id === me.id ? join.session.guest : join.session.host;
  const title = join.session.kind === "pair" ? "Pair programming" : "Coding battle";

  return (
    <div className={styles.academy}>
      <div className={styles.lessonHeader}>
        <button className={styles.back} onClick={onExit} aria-label="Back to the lab (stay in the session)" title="Back (you stay in the session)">
          ←
        </button>
        <div className={styles.grow}>
          <PanelHeader title={title} subtitle={`with ${partner.displayName} · ${join.session.lesson.title}`} onClose={onClose} />
        </div>
      </div>

      {state && <Members state={state} me={me.id} />}
      {status === "connecting" && <p className={styles.muted}>Connecting to the session…</p>}
      {status === "reconnecting" && <p className={styles.info}>Connection lost. Reconnecting…</p>}
      {status === "closed" && (
        <div className={styles.failure}>
          {closedReason ?? "The session ended."}
          <div className={styles.toolbar}>
            <button className={styles.secondary} onClick={() => void leave()}>
              Back to lessons
            </button>
          </div>
        </div>
      )}
      {lesson.error && <p className={styles.error}>{errorMessage(lesson.error)}</p>}

      {lesson.data && (
        <>
          <p className={styles.task}>
            <strong>Goal:</strong> {lesson.data.content.instructions}
          </p>
          {connection && state?.kind === "pair" && <PairWorkspace lesson={lesson.data} connection={connection} state={state} me={me.id} initialProgram={latestProgram.current} onNotice={setNotice} />}
          {connection && state?.kind === "battle" && <BattleArena lesson={lesson.data} connection={connection} state={state} me={me.id} onNotice={setNotice} />}
        </>
      )}

      {notice && <div className={styles[notice.tone === "error" ? "failure" : notice.tone]}>{notice.text}</div>}

      <div className={styles.toolbar}>
        <button className={styles.link} onClick={() => void leave()}>
          Leave the {KIND_LABEL[join.session.kind]}
        </button>
      </div>
    </div>
  );
}

function Members({ state, me }: { state: SessionStateView; me: string }) {
  return (
    <div className={styles.members}>
      {state.members.map((m) => (
        <span key={m.userId} className={styles.member} data-away={!m.connected || undefined}>
          <span className={styles.dot} data-on={m.connected || undefined} aria-hidden />
          {m.displayName || "Waiting…"}
          {m.userId === me && " (you)"}
          {state.driverId === m.userId && <span title="Has the keyboard"> ⌨️ driving</span>}
          {!m.connected && <span className={styles.muted}> · not here yet</span>}
        </span>
      ))}
    </div>
  );
}

/** Animates a run on the lab board and, when it solves the puzzle, records it for this player. */
async function playAndCredit(lessonId: string, run: RunSummary, actions: RobotAction[]): Promise<Notice> {
  labStore.reset();
  const credit =
    run.success && actions.length > 0 && actions.length <= MAX_ACTION_LOG
      ? submitAttempt(lessonId, { actions, editorMode: "blocks" }).then(
          (r) => r,
          () => null,
        )
      : Promise.resolve(null);
  const [, server] = await Promise.all([labStore.play(run.events, run.success ? "success" : "failure"), credit]);
  if (!run.success) return null;
  if (server?.firstCompletion) return { tone: "success", text: `🎉 Solved! +${server.xpAwarded} XP${server.badgesAwarded.length ? " · 🏅 new badge" : ""}` };
  return { tone: "success", text: "🎉 Solved!" };
}

// -------------------------------------------------------------------------------------------------
// Pair programming
// -------------------------------------------------------------------------------------------------

function PairWorkspace({
  lesson,
  connection,
  state,
  me,
  initialProgram,
  onNotice,
}: {
  lesson: LessonView;
  connection: SessionConnection;
  state: SessionStateView;
  me: string;
  initialProgram: SessionProgramPayload | null;
  onNotice: (n: Notice) => void;
}) {
  const editor = useRef<BlockEditorHandle>(null);
  const driving = state.driverId === me;
  const drivingRef = useRef(driving);
  drivingRef.current = driving;
  /** The shared program as last seen (sent or received); seeds the editor when roles swap. */
  const program = useRef<string | null>(initialProgram?.program ?? null);
  const version = useRef(initialProgram?.version ?? 0);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [running, setRunning] = useState(false);
  const [blockCount, setBlockCount] = useState(0);
  const driver = state.members.find((m) => m.userId === state.driverId);
  const partnerHere = state.members.some((m) => m.userId !== me && m.connected);

  const playRun = useCallback(
    async (summary: RunSummary, actions: RobotAction[], by: string) => {
      setRunning(true);
      try {
        const notice = await playAndCredit(lesson.id, summary, actions);
        onNotice(notice ?? { tone: "error", text: `${by} ran it: ${failureSentence(summary, lesson.puzzle)}` });
      } finally {
        setRunning(false);
      }
    },
    [lesson, onNotice],
  );

  useEffect(() => {
    const offs = [
      connection.on("program", (p) => {
        if (p.version < version.current) return;
        version.current = p.version;
        program.current = p.program;
        if (!drivingRef.current) editor.current?.load(p.program);
      }),
      connection.on("run", (r) => {
        // The partner's program ran on their side; replay its action log to animate the same run.
        const result = replay(lesson.puzzle, r.actions);
        const name = state.members.find((m) => m.userId === r.by)?.displayName || "Your partner";
        void playRun({ ...result, actionCount: result.actionCount }, r.actions, name);
      }),
    ];
    return () => offs.forEach((off) => off());
  }, [connection, lesson, playRun, state.members]);

  useEffect(
    () => () => {
      if (sendTimer.current) clearTimeout(sendTimer.current);
    },
    [],
  );

  const onChange = useCallback(
    (count: number) => {
      setBlockCount(count);
      if (!drivingRef.current) return;
      const serialized = editor.current?.serialize();
      if (!serialized || serialized === program.current) return;
      program.current = serialized;
      if (sendTimer.current) return;
      sendTimer.current = setTimeout(() => {
        sendTimer.current = null;
        if (drivingRef.current && program.current) connection.edit(program.current);
      }, EDIT_THROTTLE_MS);
    },
    [connection],
  );

  const run = async () => {
    const code = editor.current?.code() ?? "";
    if (!code.trim()) return onNotice({ tone: "info", text: "Snap some blocks under “when ▶ Run is pressed” first." });
    onNotice(null);
    setRunning(true);
    const r = await runProgram(code, lesson.puzzle);
    setRunning(false);
    if (r.kind !== "finished") return onNotice({ tone: "error", text: abortedSentence(r) });
    connection.run(r.actions);
    await playRun({ ...r, actionCount: r.actions.length }, r.actions, "You");
  };

  const pass = () => {
    // Make sure the partner gets the latest program before taking over.
    if (sendTimer.current) {
      clearTimeout(sendTimer.current);
      sendTimer.current = null;
    }
    if (program.current) connection.edit(program.current);
    connection.swap();
  };

  return (
    <>
      <p className={styles.muted}>
        {driving
          ? partnerHere
            ? "You have the keyboard. Talk it through with your partner while you build."
            : "You have the keyboard. Your partner will see your blocks as soon as they join."
          : `${driver?.displayName || "Your partner"} is driving. Follow along and suggest the next block!`}
      </p>
      {/* A new editor when roles swap: read-only for the navigator, seeded with the shared program. */}
      <BlockEditor
        key={driving ? "driver" : "navigator"}
        ref={editor}
        puzzle={lesson.puzzle}
        initial={program.current}
        onChange={onChange}
        readOnly={!driving}
      />
      <div className={styles.toolbar}>
        {driving && (
          <>
            <button className={styles.run} onClick={() => void run()} disabled={running}>
              {running ? "Running…" : "▶ Run"}
            </button>
            <button className={styles.secondary} onClick={pass} disabled={!partnerHere || running}>
              Pass the keyboard
            </button>
          </>
        )}
        <span className={styles.blockCount}>
          {blockCount}
          {lesson.puzzle.maxBlocks !== null ? ` / ${lesson.puzzle.maxBlocks}` : ""} blocks
        </span>
      </div>
    </>
  );
}

// -------------------------------------------------------------------------------------------------
// Coding battle
// -------------------------------------------------------------------------------------------------

function BattleArena({
  lesson,
  connection,
  state,
  me,
  onNotice,
}: {
  lesson: LessonView;
  connection: SessionConnection;
  state: SessionStateView;
  me: string;
  onNotice: (n: Notice) => void;
}) {
  const battle = state.battle!;
  const editor = useRef<BlockEditorHandle>(null);
  const [running, setRunning] = useState(false);
  const [round, setRound] = useState(1);
  const [now, setNow] = useState(Date.now());
  const lastRun = useRef<{ summary: RunSummary; actions: RobotAction[] } | null>(null);
  const mine = battle.players.find((p) => p.userId === me);
  const theirs = battle.players.find((p) => p.userId !== me);
  const name = (id: string | undefined) => state.members.find((m) => m.userId === id)?.displayName || "Your opponent";

  // A rematch starts a fresh editor.
  const phase = battle.phase;
  const prevPhase = useRef(phase);
  useEffect(() => {
    if (prevPhase.current === "finished" && phase === "waiting") {
      setRound((r) => r + 1);
      onNotice(null);
      labStore.reset();
    }
    prevPhase.current = phase;
  }, [phase, onNotice]);

  useEffect(() => {
    if (phase !== "countdown") return;
    const t = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(
    () =>
      connection.on("verdict", (v) => {
        const last = lastRun.current;
        if (!last) return;
        // The room has replayed the log; credit the solve to this player too (verified again by the API).
        void playAndCredit(lesson.id, last.summary, last.actions).then((notice) => {
          if (v.success) onNotice({ tone: "success", text: `${v.won ? "🏆 You won the race!" : "✓ Solved, but not first this time."} ${notice?.text.replace("🎉 Solved!", "").trim() ?? ""}`.trim() });
          else onNotice({ tone: "error", text: failureSentence(last.summary, lesson.puzzle) });
        });
      }),
    [connection, lesson, onNotice],
  );

  const run = async () => {
    const code = editor.current?.code() ?? "";
    if (!code.trim()) return onNotice({ tone: "info", text: "Snap some blocks under “when ▶ Run is pressed” first." });
    onNotice(null);
    setRunning(true);
    try {
      const r = await runProgram(code, lesson.puzzle);
      if (r.kind !== "finished") return onNotice({ tone: "error", text: abortedSentence(r) });
      lastRun.current = { summary: { ...r, actionCount: r.actions.length }, actions: r.actions };
      connection.submit(r.actions);
    } finally {
      setRunning(false);
    }
  };

  if (phase === "waiting" || phase === "countdown") {
    const seconds = battle.startsAt ? Math.max(0, Math.ceil((battle.startsAt - now) / 1000)) : 0;
    return (
      <div className={styles.lobby}>
        {phase === "countdown" ? (
          <div className={styles.countdown} aria-live="assertive">
            {seconds > 0 ? seconds : "Go!"}
          </div>
        ) : (
          <>
            <p>Study the board. The editor opens when the race starts.</p>
            <ul className={styles.readyList}>
              {battle.players.map((p) => (
                <li key={p.userId}>
                  {p.ready ? "✅" : "⏳"} {p.userId === me ? "You" : name(p.userId)} {p.ready ? "ready" : "not ready yet"}
                </li>
              ))}
            </ul>
            <button className={styles.run} onClick={() => connection.ready()} disabled={mine?.ready}>
              {mine?.ready ? "Waiting for your opponent…" : "I'm ready"}
            </button>
          </>
        )}
      </div>
    );
  }

  const finished = phase === "finished";
  return (
    <>
      <div className={styles.raceStatus}>
        <span>
          You: {mine?.solved ? `✓ solved in ${mine.actionCount} moves` : `${mine?.attempts ?? 0} tries`}
        </span>
        <span>
          {name(theirs?.userId)}: {theirs?.solved ? `✓ solved${theirs.timeMs !== null ? ` in ${Math.round(theirs.timeMs / 1000)} s` : ""}` : `${theirs?.attempts ?? 0} tries`}
        </span>
      </div>
      {finished && (
        <div className={battle.winnerId === me ? styles.success : styles.info}>
          <strong>{battle.winnerId === me ? "🏆 You won!" : `🏁 ${name(battle.winnerId ?? undefined)} won this round.`}</strong>
          <div className={styles.toolbar}>
            <button className={styles.run} onClick={() => connection.rematch()}>
              Rematch
            </button>
          </div>
        </div>
      )}
      <BlockEditor key={`round-${round}`} ref={editor} puzzle={lesson.puzzle} initial={null} onChange={() => undefined} />
      <div className={styles.toolbar}>
        <button className={styles.run} onClick={() => void run()} disabled={running}>
          {running ? "Running…" : "▶ Run"}
        </button>
      </div>
    </>
  );
}
