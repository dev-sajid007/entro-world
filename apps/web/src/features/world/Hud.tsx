import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ZONES, ZONE_IDS, type ZoneId } from "@entroworld/shared";
import { EMOTES } from "@entroworld/avatar";
import { Buttons, type ChatChannel } from "@entroworld/game-protocol";
import type { InteractiveKind, InteractiveObject } from "@entroworld/world-assets";
import type { GameEngine } from "../../game/core/GameEngine";
import styles from "./Hud.module.css";

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  offline: { text: "Sandbox (offline)", color: "#94a3b8" },
  connecting: { text: "Connecting…", color: "#fbbf24" },
  connected: { text: "Online", color: "#4ade80" },
  reconnecting: { text: "Reconnecting…", color: "#fbbf24" },
  transferring: { text: "Changing zone…", color: "#38bdf8" },
  disconnected: { text: "Disconnected", color: "#f87171" },
};

const EMOTE_ICONS: Record<string, string> = { wave: "👋", dance: "💃", cheer: "🙌", clap: "👏", laugh: "😂", think: "🤔", shrug: "🤷", bow: "🙇" };

export interface PanelRequest {
  kind: InteractiveKind;
  object: InteractiveObject;
}

export interface HudProps {
  engine: GameEngine;
  /** Renders panels for boards, plots and screens (provided by the social layer). */
  renderPanel?: (panel: PanelRequest, close: () => void) => ReactNode;
  /** Extra HUD elements (voice controls, etc.). */
  extras?: ReactNode;
  topRight?: ReactNode;
}

function useEngineUi(engine: GameEngine) {
  return useSyncExternalStore(engine.ui.subscribe, engine.ui.get);
}

export function Hud({ engine, renderPanel, extras, topRight }: HudProps) {
  const ui = useEngineUi(engine);
  const [panel, setPanel] = useState<PanelRequest | null>(null);
  const [help, setHelp] = useState(() => {
    try {
      return localStorage.getItem("ew:help-seen") !== "1";
    } catch {
      return true;
    }
  });
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const touch = useRef(typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches).current;

  useEffect(() => {
    const offs = [
      engine.events.on("openPanel", (p) => {
        setPanel(p);
        if (document.pointerLockElement) document.exitPointerLock();
      }),
      engine.events.on("escape", () => {
        setPanel(null);
        setHelp(false);
      }),
      engine.events.on("toggleHelp", () => setHelp((h) => !h)),
      engine.events.on("system", (text) => {
        const id = Date.now() + Math.random();
        setToasts((t) => [...t.slice(-3), { id, text }]);
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [engine]);

  useEffect(() => {
    engine.input.setEnabled(panel === null);
  }, [engine, panel]);

  const closeHelp = () => {
    setHelp(false);
    try {
      localStorage.setItem("ew:help-seen", "1");
    } catch {
      // Storage unavailable (private mode); the overlay simply shows again next time.
    }
  };

  const status = STATUS_LABEL[ui.status] ?? STATUS_LABEL.offline!;
  const closePanel = () => setPanel(null);

  return (
    <div className={styles.hud}>
      <div className={styles.topLeft}>
        <div className={styles.zoneCard}>
          <div className={styles.zoneName}>{ZONES[ui.zoneId].name}</div>
          <div className={styles.zoneMeta}>
            <span className={styles.statusDot} style={{ background: status.color }} />
            {status.text}
            {ui.status !== "offline" && <span>· {ui.playersInView} nearby</span>}
          </div>
        </div>
        <div className={styles.stats}>
          {ui.fps} FPS{ui.latency !== null ? ` · ${ui.latency} ms` : ""} · {ui.x}, {ui.z}
        </div>
        {ui.status === "disconnected" && (
          <button className={styles.retry} onClick={() => engine.retryConnection()}>
            Reconnect
          </button>
        )}
      </div>

      {topRight && <div className={styles.topRight}>{topRight}</div>}

      {ui.nearby && !panel && (
        <button className={styles.prompt} onClick={() => engine.interact()}>
          <kbd>E</kbd> {promptVerb(ui.nearby.kind)} {ui.nearby.label}
        </button>
      )}
      {ui.seated && !panel && (
        <button className={styles.prompt} onClick={() => engine.standUp()}>
          <kbd>E</kbd> Stand up
        </button>
      )}

      {!ui.pointerLocked && !touch && !panel && !help && <div className={styles.lookHint}>Click the world to look around · H for help</div>}

      <div className={styles.toasts}>
        {toasts.map((t) => (
          <div key={t.id} className={styles.toast}>
            {t.text}
          </div>
        ))}
      </div>

      <div className={styles.bottomLeft}>
        <ChatPanel engine={engine} />
      </div>

      <div className={styles.bottomRight}>
        {extras}
        <div className={styles.emotes} role="toolbar" aria-label="Emotes">
          {EMOTES.map((e, i) => (
            <button key={e} className={styles.emote} title={`${e} (${i + 1})`} onClick={() => engine.emote(e)}>
              <span aria-hidden>{EMOTE_ICONS[e]}</span>
              <span className="sr-only">{e}</span>
            </button>
          ))}
        </div>
      </div>

      {touch && <TouchControls engine={engine} />}

      {help && <HelpOverlay onClose={closeHelp} />}

      {panel && (
        <div className={styles.panelBackdrop} onClick={closePanel}>
          <div className={styles.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label={panel.object.label}>
            {panel.kind === "kiosk" ? (
              <KioskPanel engine={engine} kiosk={panel.object} current={ui.zoneId} onClose={closePanel} />
            ) : (
              (renderPanel?.(panel, closePanel) ?? <DefaultPanel panel={panel} onClose={closePanel} />)
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function promptVerb(kind: InteractiveKind): string {
  switch (kind) {
    case "seat":
      return "Sit on";
    case "board":
      return "Read";
    case "kiosk":
      return "Use";
    case "fountain":
      return "Toggle";
    case "screen":
      return "View";
    case "plotSign":
      return "Visit";
  }
}

function DefaultPanel({ panel, onClose }: { panel: PanelRequest; onClose: () => void }) {
  return (
    <div>
      <PanelHeader title={panel.object.label} onClose={onClose} />
      <p className={styles.muted}>Sign in to use this.</p>
    </div>
  );
}

export function PanelHeader({ title, onClose, subtitle }: { title: string; subtitle?: string; onClose: () => void }) {
  return (
    <div className={styles.panelHeader}>
      <div>
        <h2>{title}</h2>
        {subtitle && <p className={styles.muted}>{subtitle}</p>}
      </div>
      <button className={styles.close} onClick={onClose} aria-label="Close">
        ×
      </button>
    </div>
  );
}

function KioskPanel({ engine, kiosk, current, onClose }: { engine: GameEngine; kiosk: InteractiveObject; current: ZoneId; onClose: () => void }) {
  return (
    <div>
      <PanelHeader title="City transit" subtitle="Travel instantly to another district." onClose={onClose} />
      <div className={styles.zoneGrid}>
        {ZONE_IDS.map((id) => (
          <button
            key={id}
            className={styles.zoneButton}
            disabled={id === current}
            onClick={() => {
              engine.travel(kiosk.id, id);
              onClose();
            }}
          >
            <strong>{ZONES[id].name}</strong>
            <span>{id === current ? "You are here" : ZONES[id].description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const CHANNELS: { id: ChatChannel; label: string }[] = [
  { id: "room", label: "Room" },
  { id: "zone", label: "Zone" },
  { id: "global", label: "Global" },
];

function ChatPanel({ engine }: { engine: GameEngine }) {
  const { entries } = useSyncExternalStore(engine.chat.subscribe, engine.chat.get);
  const [channel, setChannel] = useState<ChatChannel>("room");
  const [text, setText] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(
    () =>
      engine.events.on("chatFocus", () => {
        setCollapsed(false);
        if (document.pointerLockElement) document.exitPointerLock();
        setTimeout(() => inputRef.current?.focus(), 0);
      }),
    [engine],
  );

  const visible = entries.filter((e) => channel === "room" || e.channel === channel);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [visible.length]);

  return (
    <div className={`${styles.chat} ${collapsed ? styles.chatCollapsed : ""}`}>
      <div className={styles.chatTabs} role="tablist">
        {CHANNELS.map((c) => (
          <button key={c.id} role="tab" aria-selected={channel === c.id} className={channel === c.id ? styles.tabActive : styles.tab} onClick={() => setChannel(c.id)}>
            {c.label}
          </button>
        ))}
        <button className={styles.tab} onClick={() => setCollapsed((c) => !c)} aria-label={collapsed ? "Expand chat" : "Collapse chat"}>
          {collapsed ? "▴" : "▾"}
        </button>
      </div>
      {!collapsed && (
        <>
          <div className={styles.chatList} ref={listRef} aria-live="polite">
            {visible.length === 0 && <div className={styles.muted}>Say hello! Press Enter to chat.</div>}
            {visible.map((m) => (
              <div key={m.id} className={styles.chatLine}>
                {m.channel !== "room" && <span className={styles.chatChannel}>[{m.channel}]</span>}
                <span className={m.self ? styles.chatSelf : styles.chatName}>{m.from.displayName}:</span> <span>{m.text}</span>
              </div>
            ))}
          </div>
          <form
            className={styles.chatForm}
            onSubmit={(e) => {
              e.preventDefault();
              engine.sendChat(channel === "room" ? "room" : channel, text);
              setText("");
              inputRef.current?.blur();
            }}
          >
            <input
              ref={inputRef}
              value={text}
              maxLength={280}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") inputRef.current?.blur();
              }}
              placeholder={`Message ${channel} chat…`}
              aria-label="Chat message"
            />
          </form>
        </>
      )}
    </div>
  );
}

function HelpOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div className={styles.panelBackdrop} onClick={onClose}>
      <div className={styles.panel} onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Controls">
        <PanelHeader title="Welcome to EntroWorld" subtitle="Explore the city, meet people and make it your own." onClose={onClose} />
        <div className={styles.helpGrid}>
          <span><kbd>W A S D</kbd></span><span>Move</span>
          <span><kbd>Shift</kbd></span><span>Run</span>
          <span><kbd>Space</kbd></span><span>Jump</span>
          <span><kbd>Mouse</kbd></span><span>Look around (click to lock, Esc to release)</span>
          <span><kbd>Wheel</kbd></span><span>Zoom</span>
          <span><kbd>E</kbd></span><span>Interact: sit, read boards, use transit kiosks</span>
          <span><kbd>Enter</kbd></span><span>Chat</span>
          <span><kbd>1–8</kbd></span><span>Emotes</span>
          <span><kbd>V</kbd></span><span>Toggle proximity voice</span>
          <span><kbd>H</kbd></span><span>Show this help</span>
        </div>
        <button className={styles.primary} onClick={onClose}>
          Start exploring
        </button>
      </div>
    </div>
  );
}

function TouchControls({ engine }: { engine: GameEngine }) {
  const stick = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const active = useRef<number | null>(null);
  const look = useRef<{ id: number; x: number; y: number } | null>(null);

  const moveStick = (clientX: number, clientY: number) => {
    const el = stick.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = (clientX - cx) / (r.width / 2);
    let dy = (clientY - cy) / (r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > 1) {
      dx /= len;
      dy /= len;
    }
    engine.input.setJoystick(dx, dy);
    if (knob.current) knob.current.style.transform = `translate(${dx * 38}px, ${dy * 38}px)`;
  };

  return (
    <>
      <div
        className={styles.lookArea}
        onTouchStart={(e) => {
          const t = e.changedTouches[0];
          if (t) look.current = { id: t.identifier, x: t.clientX, y: t.clientY };
        }}
        onTouchMove={(e) => {
          for (const t of Array.from(e.changedTouches)) {
            if (look.current && t.identifier === look.current.id) {
              engine.input.addLook((t.clientX - look.current.x) * 1.6, (t.clientY - look.current.y) * 1.6);
              look.current = { id: t.identifier, x: t.clientX, y: t.clientY };
            }
          }
        }}
        onTouchEnd={() => (look.current = null)}
      />
      <div
        ref={stick}
        className={styles.stick}
        onTouchStart={(e) => {
          const t = e.changedTouches[0];
          if (!t) return;
          active.current = t.identifier;
          moveStick(t.clientX, t.clientY);
        }}
        onTouchMove={(e) => {
          for (const t of Array.from(e.changedTouches)) if (t.identifier === active.current) moveStick(t.clientX, t.clientY);
        }}
        onTouchEnd={() => {
          active.current = null;
          engine.input.setJoystick(0, 0);
          if (knob.current) knob.current.style.transform = "";
        }}
      >
        <div ref={knob} className={styles.knob} />
      </div>
      <div className={styles.touchButtons}>
        <button
          className={styles.touchButton}
          onTouchStart={() => engine.input.setVirtualButton(Buttons.Jump, true)}
          onTouchEnd={() => engine.input.setVirtualButton(Buttons.Jump, false)}
        >
          Jump
        </button>
        <button className={styles.touchButton} onClick={() => engine.interact()}>
          Use
        </button>
        <button className={styles.touchButton} onClick={() => engine.events.emit("chatFocus", undefined)}>
          Chat
        </button>
      </div>
    </>
  );
}
