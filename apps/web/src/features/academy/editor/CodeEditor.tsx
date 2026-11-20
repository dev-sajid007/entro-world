import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor/editor";
import "monaco-editor/languages/definitions/javascript/register";
import { javascriptDefaults } from "monaco-editor/languages/features/typescript/register";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import TsWorker from "monaco-editor/language/typescript/ts.worker?worker";
import { MAX_STEPS_PER_MOVE, type PuzzleDefinition, type RobotMethod } from "@entroworld/robot-api";
import styles from "../Academy.module.css";

/**
 * Monaco text editor for the Academy's split and code modes (SPEC-ADDENDUM-01 §3.1). This module is
 * large, so the Academy loads it lazily the first time a learner opens a text view.
 */

// Monaco runs its language services in workers bundled by Vite.
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker: (_id, label) => (label === "typescript" || label === "javascript" ? new TsWorker() : new EditorWorker()),
};

monaco.editor.defineTheme("entro-dark", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: { "editor.background": "#0f172a", "editor.lineHighlightBackground": "#1e293b80", "editorGutter.background": "#0f172a" },
});

javascriptDefaults.setCompilerOptions({ target: 99, allowNonTsExtensions: true, noLib: true, checkJs: true });
javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: false, noSyntaxValidation: false });

/** Documentation of each robot method, for autocomplete and hover help. */
const API_DOCS: Record<RobotMethod, string> = {
  moveForward: `/** Drive forward this many tiles (1 to ${MAX_STEPS_PER_MOVE}). */\n  moveForward(steps?: number): void;`,
  turnLeft: "/** Turn a quarter turn left, on the spot. */\n  turnLeft(): void;",
  turnRight: "/** Turn a quarter turn right, on the spot. */\n  turnRight(): void;",
  jump: "/** Hop over one tile, like a gap. */\n  jump(): void;",
  pickUp: "/** Pick up the battery on this tile. */\n  pickUp(): void;",
  drop: "/** Put a battery down on this tile. */\n  drop(): void;",
  say: "/** Show a speech bubble. */\n  say(text: string): void;",
  isPathClear: "/** True when the robot can drive onto the tile ahead. */\n  isPathClear(): boolean;",
  sensor: '/** What is next to the robot: "empty", "wall" (also gaps and the board edge) or "item" (a battery). */\n  sensor(direction?: "front" | "left" | "right"): "empty" | "wall" | "item";',
  atExit: "/** True while the robot stands on the exit door. */\n  atExit(): boolean;",
};

/** The `robot` declaration for one puzzle: only the methods it allows, so autocomplete never suggests the rest. */
export function robotTypings(puzzle: PuzzleDefinition): string {
  const members = puzzle.allowedApi.map((m) => `  ${API_DOCS[m]}`).join("\n");
  return `/** Your robot companion. */\ndeclare const robot: {\n${members}\n};\n`;
}

let typings: monaco.IDisposable | null = null;

interface Props {
  puzzle: PuzzleDefinition;
  value: string;
  /** Not called for read-only editors. */
  onChange?: (code: string) => void;
  readOnly?: boolean;
  /** Accessible name of the editor. */
  label: string;
}

export default function CodeEditor({ puzzle, value, onChange, readOnly = false, label }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (readOnly) return;
    typings?.dispose();
    typings = javascriptDefaults.addExtraLib(robotTypings(puzzle), "ts:entroworld/robot.d.ts");
  }, [puzzle, readOnly]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ed = monaco.editor.create(el, {
      value,
      language: "javascript",
      theme: "entro-dark",
      readOnly,
      ariaLabel: label,
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      lineNumbersMinChars: 3,
      scrollBeyondLastLine: false,
      tabSize: 2,
      wordWrap: "on",
      renderLineHighlight: readOnly ? "none" : "line",
      fixedOverflowWidgets: true,
    });
    editor.current = ed;
    const sub = ed.onDidChangeModelContent(() => onChangeRef.current?.(ed.getValue()));
    return () => {
      sub.dispose();
      ed.getModel()?.dispose();
      ed.dispose();
      editor.current = null;
    };
    // `value` is the starting text; later changes are applied below without recreating the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, label]);

  useEffect(() => {
    const ed = editor.current;
    if (ed && ed.getValue() !== value) ed.setValue(value);
  }, [value]);

  // Keys typed into the editor must not reach the world's shortcuts.
  return <div ref={host} className={styles.code} data-readonly={readOnly || undefined} onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()} />;
}
