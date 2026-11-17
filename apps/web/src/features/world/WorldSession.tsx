import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AvatarConfig, WorldJoinResponse, ZoneId } from "@entroworld/shared";
import { GameEngine } from "../../game/core/GameEngine";

export type WorldMode = "online" | "offline";

export interface StartOptions {
  mode: WorldMode;
  userId: string | null;
  username: string;
  displayName: string;
  avatar: AvatarConfig;
  requestTicket?: (zoneId?: ZoneId) => Promise<WorldJoinResponse>;
  isBlocked?: (userId: string) => boolean;
}

interface WorldSessionValue {
  engine: GameEngine | null;
  mode: WorldMode | null;
  /** Account the running session belongs to (null for guests and the sandbox). */
  userId: string | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  start: (options: StartOptions) => Promise<void>;
  stop: () => Promise<void>;
}

const WorldSessionContext = createContext<WorldSessionValue | null>(null);

/**
 * Holds the running game engine at the app level so the 3D world (and its multiplayer
 * connection) survives navigation between the world and social pages.
 */
export function WorldSessionProvider({ children }: { children: ReactNode }) {
  const [engine, setEngine] = useState<GameEngine | null>(null);
  const [mode, setMode] = useState<WorldMode | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<WorldSessionValue["status"]>("idle");
  const [error, setError] = useState<string | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const startToken = useRef(0);

  const stop = useCallback(async () => {
    startToken.current++;
    const current = engineRef.current;
    engineRef.current = null;
    setEngine(null);
    setMode(null);
    setUserId(null);
    setStatus("idle");
    if (current) await current.dispose();
  }, []);

  const start = useCallback(
    async (options: StartOptions) => {
      if (engineRef.current) await stop();
      const token = ++startToken.current;
      setStatus("loading");
      setError(null);
      try {
        const created = await GameEngine.create({
          userId: options.userId,
          username: options.username,
          displayName: options.displayName,
          avatar: options.avatar,
          online: options.mode === "online" && options.requestTicket ? { requestTicket: options.requestTicket } : null,
          ...(options.isBlocked ? { isBlocked: options.isBlocked } : {}),
        });
        if (token !== startToken.current) {
          await created.dispose();
          return;
        }
        engineRef.current = created;
        // Expose the engine for debugging and automated browser checks in development builds.
        if (import.meta.env.DEV) (window as unknown as { __entro?: GameEngine }).__entro = created;
        setEngine(created);
        setMode(options.mode);
        setUserId(options.userId);
        setStatus("ready");
      } catch (e) {
        if (token !== startToken.current) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : "Could not enter the world");
      }
    },
    [stop],
  );

  useEffect(() => () => void engineRef.current?.dispose(), []);

  const value = useMemo(() => ({ engine, mode, userId, status, error, start, stop }), [engine, mode, userId, status, error, start, stop]);
  return <WorldSessionContext.Provider value={value}>{children}</WorldSessionContext.Provider>;
}

export function useWorldSession(): WorldSessionValue {
  const ctx = useContext(WorldSessionContext);
  if (!ctx) throw new Error("useWorldSession must be used inside WorldSessionProvider");
  return ctx;
}
