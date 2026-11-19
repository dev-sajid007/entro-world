import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as Blockly from "blockly/core";
import type { PuzzleDefinition } from "@entroworld/robot-api";
import { START_BLOCK, countBlocks, registerRobotBlocks, toolboxFor, workspaceCode } from "./blocks";
import styles from "../Academy.module.css";

export interface BlockEditorHandle {
  /** The program as JavaScript. */
  code(): string;
  /** The workspace, serialized for saving as a draft. */
  serialize(): string;
  /** Clears the workspace back to the start block. */
  clear(): void;
  /** Replaces the workspace with a serialized one (a pair partner's edit). Doesn't call `onChange`. */
  load(serialized: string): void;
}

interface Props {
  puzzle: PuzzleDefinition;
  /** A saved workspace (from {@link BlockEditorHandle.serialize}), if any. */
  initial: string | null;
  /** Called after every edit (not on scrolling or selecting). */
  onChange: (blockCount: number) => void;
  readOnly?: boolean;
}

let theme: Blockly.Theme | null = null;
function darkTheme(): Blockly.Theme {
  theme ??= Blockly.Theme.defineTheme("entro-dark", {
    name: "entro-dark",
    base: Blockly.Themes.Classic,
    componentStyles: {
      workspaceBackgroundColour: "#0f172a",
      toolboxBackgroundColour: "#111a2e",
      flyoutBackgroundColour: "#1e293b",
      flyoutOpacity: 1,
      scrollbarColour: "#475569",
      insertionMarkerColour: "#f8fafc",
      insertionMarkerOpacity: 0.3,
    },
    fontStyle: { family: "Inter, system-ui, sans-serif", weight: "600", size: 12 },
  });
  return theme;
}

function addStartBlock(ws: Blockly.WorkspaceSvg): void {
  const start = ws.newBlock(START_BLOCK);
  start.setDeletable(false);
  start.initSvg();
  start.render();
  start.moveBy(24, 24);
}

/** Blockly workspace for one puzzle. Blocks not attached under the start block are greyed out. */
export const BlockEditor = forwardRef<BlockEditorHandle, Props>(function BlockEditor({ puzzle, initial, onChange, readOnly = false }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const workspace = useRef<Blockly.WorkspaceSvg | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  /** True while applying a remote workspace, so it isn't reported as a local edit. */
  const applying = useRef(false);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    registerRobotBlocks();
    const ws = Blockly.inject(el, {
      toolbox: toolboxFor(puzzle),
      theme: darkTheme(),
      renderer: "zelos",
      // The start block counts towards Blockly's limit, so allow one more.
      maxBlocks: puzzle.maxBlocks === null ? Infinity : puzzle.maxBlocks + 1,
      trashcan: true,
      sounds: false,
      readOnly,
      move: { scrollbars: true, drag: true, wheel: false },
      zoom: { controls: true, wheel: true, startScale: 0.85, maxScale: 1.6, minScale: 0.5 },
    });
    workspace.current = ws;

    let loaded = false;
    if (initial) {
      try {
        Blockly.serialization.workspaces.load(JSON.parse(initial) as object, ws);
        loaded = ws.getBlocksByType(START_BLOCK, false).length === 1;
      } catch {
        loaded = false;
      }
    }
    if (!loaded) {
      ws.clear();
      addStartBlock(ws);
    }
    ws.getBlocksByType(START_BLOCK, false).forEach((b) => b.setDeletable(false));

    ws.addChangeListener(Blockly.Events.disableOrphans);
    ws.addChangeListener((e) => {
      if (e.isUiEvent || ws.isDragging() || applying.current) return;
      onChangeRef.current(countBlocks(ws));
    });
    onChangeRef.current(countBlocks(ws));

    const resize = new ResizeObserver(() => Blockly.svgResize(ws));
    resize.observe(el);
    return () => {
      resize.disconnect();
      workspace.current = null;
      ws.dispose();
    };
    // The workspace is rebuilt only for a different puzzle; `initial` is read once per puzzle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puzzle, readOnly]);

  useImperativeHandle(
    ref,
    () => ({
      code: () => (workspace.current ? workspaceCode(workspace.current) : ""),
      serialize: () => (workspace.current ? JSON.stringify(Blockly.serialization.workspaces.save(workspace.current)) : ""),
      clear: () => {
        const ws = workspace.current;
        if (!ws) return;
        ws.clear();
        addStartBlock(ws);
      },
      load: (serialized) => {
        const ws = workspace.current;
        if (!ws) return;
        applying.current = true;
        try {
          Blockly.Events.disable();
          Blockly.serialization.workspaces.load(JSON.parse(serialized) as object, ws);
          if (ws.getBlocksByType(START_BLOCK, false).length !== 1) {
            ws.clear();
            addStartBlock(ws);
          }
          ws.getBlocksByType(START_BLOCK, false).forEach((b) => b.setDeletable(false));
        } catch {
          // A malformed workspace from the partner leaves ours as it was.
        } finally {
          Blockly.Events.enable();
          applying.current = false;
        }
        // Greyed-out loose blocks keep that state: it is part of the serialized workspace.
        onChangeRef.current(countBlocks(ws));
      },
    }),
    [],
  );

  // Keys typed into block fields must not reach the world's shortcuts.
  return <div ref={host} className={styles.blockly} onKeyDown={(e) => e.stopPropagation()} onKeyUp={(e) => e.stopPropagation()} />;
});
