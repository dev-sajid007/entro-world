import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CLASS_CODE_MAX, CLASS_TITLE_MAX, parseClassScreen } from "@entroworld/game-protocol";
import type { InteractiveObject } from "@entroworld/world-assets";
import type { GameEngine } from "../../game/core/GameEngine";
import { errorMessage } from "../../lib/api";
import { PanelHeader } from "../world/Hud";
import { BlockEditor, type BlockEditorHandle } from "./editor/BlockEditor";
import { useLesson, useTracks } from "./hooks";
import { runProgram } from "./sandbox/runProgram";
import { abortedSentence, failureSentence } from "./social/runText";
import styles from "./Academy.module.css";

/** Pushes the presenter's code to the screen at most this often. */
const UPDATE_DELAY_MS = 400;

/** What this browser is presenting, so reopening the panel brings the editor back as it was. */
let presenting: { lessonId: string; workspace: string | null } | null = null;

/**
 * Live classes (SPEC-ADDENDUM-01 §3.3): anyone signed in can take a free Event Center screen and
 * teach. The presenter builds a program in the block editor; the code it generates and the last
 * run's result appear on the big screen for everyone in the zone.
 */
export default function ClassPanel({ engine, screen, onClose }: { engine: GameEngine; screen: InteractiveObject; onClose: () => void }) {
  useSyncExternalStore(engine.objectsVersion.subscribe, engine.objectsVersion.get);
  const object = engine.objects.get(screen.id);
  const content = parseClassScreen(object?.value ?? "");
  const mine = !!object?.occupant && object.occupant === engine.sessionId;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => engine.events.on("serverError", (e) => setError(e.message)), [engine]);
  // Our class ended (here or because we left the zone): forget the editor state.
  const wasMine = useRef(mine);
  useEffect(() => {
    if (wasMine.current && !mine) presenting = null;
    wasMine.current = mine;
  }, [mine]);

  if (!engine.isOnline) {
    return (
      <div className={styles.academy}>
        <PanelHeader title={screen.label} onClose={onClose} />
        <p className={styles.muted}>Live classes need a connection to the city.</p>
      </div>
    );
  }

  if (mine && content && presenting) {
    return <Presenter engine={engine} screen={screen} title={content.title} lessonId={presenting.lessonId} onClose={onClose} error={error} />;
  }

  if (content) {
    return (
      <div className={styles.academy}>
        <PanelHeader title={`📚 ${content.title}`} subtitle={`Live class by ${content.presenterName}`} onClose={onClose} />
        <pre className={styles.codePreview}>{content.code || "// The presenter hasn't written any code yet."}</pre>
        {content.status && <div className={styles.info}>{content.status}</div>}
        {mine && (
          <button className={styles.secondary} onClick={() => engine.endClass()}>
            End the class
          </button>
        )}
        <p className={styles.muted}>Want to try it yourself? Visit the Puzzle Lab at the Coding Academy.</p>
      </div>
    );
  }

  return <StartClass engine={engine} screen={screen} onClose={onClose} error={error} onError={setError} />;
}

function StartClass({
  engine,
  screen,
  onClose,
  error,
  onError,
}: {
  engine: GameEngine;
  screen: InteractiveObject;
  onClose: () => void;
  error: string | null;
  onError: (e: string | null) => void;
}) {
  const tracks = useTracks();
  const lessons = tracks.data?.flatMap((t) => t.lessons) ?? [];
  const [title, setTitle] = useState("");
  const [lessonId, setLessonId] = useState("");

  const start = () => {
    const lesson = lessons.find((l) => l.id === lessonId);
    if (!lesson) return;
    onError(null);
    presenting = { lessonId, workspace: null };
    engine.startClass(screen.id, title.trim() || lesson.title);
  };

  return (
    <div className={styles.academy}>
      <PanelHeader title={screen.label} subtitle="The screen is free. Teach a live class!" onClose={onClose} />
      <p className={styles.muted}>Build a program with blocks. Everyone in the Event Center sees your code and its result on the big screen.</p>
      <label className={styles.field}>
        <span>Puzzle to teach</span>
        <select value={lessonId} onChange={(e) => setLessonId(e.target.value)}>
          <option value="">{tracks.isPending ? "Loading…" : "Choose a puzzle"}</option>
          {lessons.map((l, i) => (
            <option key={l.id} value={l.id}>
              {i + 1}. {l.title} · {l.concept}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        <span>Class title (optional)</span>
        <input value={title} maxLength={CLASS_TITLE_MAX} placeholder="e.g. Loops in 5 minutes" onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      </label>
      {tracks.error && <p className={styles.error}>{errorMessage(tracks.error)}</p>}
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.toolbar}>
        <button className={styles.run} disabled={!lessonId} onClick={start}>
          Start the class
        </button>
      </div>
    </div>
  );
}

function Presenter({
  engine,
  screen,
  title,
  lessonId,
  onClose,
  error,
}: {
  engine: GameEngine;
  screen: InteractiveObject;
  title: string;
  lessonId: string;
  onClose: () => void;
  error: string | null;
}) {
  const lesson = useLesson(lessonId);
  const editor = useRef<BlockEditorHandle>(null);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const statusRef = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef<string | null>(null);

  const push = useCallback(() => {
    timer.current = null;
    const code = (editor.current?.code() ?? "").slice(0, CLASS_CODE_MAX);
    const key = `${code}\u0000${statusRef.current}`;
    if (key === lastSent.current) return;
    lastSent.current = key;
    engine.updateClass(code, statusRef.current);
  }, [engine]);

  const schedule = useCallback(() => {
    if (presenting) presenting.workspace = editor.current?.serialize() ?? presenting.workspace;
    if (!timer.current) timer.current = setTimeout(push, UPDATE_DELAY_MS);
  }, [push]);

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        push();
      }
    },
    [push],
  );

  const setLine = (line: string) => {
    statusRef.current = line;
    setStatus(line);
    schedule();
  };

  const run = async () => {
    const puzzle = lesson.data?.puzzle;
    const code = editor.current?.code() ?? "";
    if (!puzzle || !code.trim()) return;
    setRunning(true);
    try {
      const r = await runProgram(code, puzzle);
      if (r.kind !== "finished") return setLine(`⚠ ${abortedSentence(r)}`);
      setLine(
        r.success
          ? `▶ Run: ✓ the robot reached the goal in ${r.actions.length} move${r.actions.length === 1 ? "" : "s"}`
          : `▶ Run: ✗ ${failureSentence({ ...r, actionCount: r.actions.length }, puzzle)}`,
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className={styles.academy}>
      <PanelHeader title={`📚 ${title}`} subtitle={`You're presenting on the ${screen.label.toLowerCase()}${lesson.data ? ` · ${lesson.data.title}` : ""}`} onClose={onClose} />
      {lesson.data && (
        <>
          <p className={styles.task}>
            <strong>Goal:</strong> {lesson.data.content.instructions}
          </p>
          <BlockEditor ref={editor} puzzle={lesson.data.puzzle} initial={presenting?.workspace ?? null} onChange={schedule} />
        </>
      )}
      {lesson.error && <p className={styles.error}>{errorMessage(lesson.error)}</p>}
      {status && <div className={styles.info}>{status}</div>}
      {error && <p className={styles.error}>{error}</p>}
      <div className={styles.toolbar}>
        <button className={styles.run} onClick={() => void run()} disabled={running || !lesson.data}>
          {running ? "Running…" : "▶ Run for the class"}
        </button>
        <button
          className={styles.secondary}
          onClick={() => {
            presenting = null;
            engine.endClass();
          }}
        >
          End the class
        </button>
      </div>
    </div>
  );
}
