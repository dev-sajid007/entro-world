import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useWorldSession } from "../world/WorldSession";
import { VoiceManager, type VoiceState } from "./VoiceManager";

const VoiceContext = createContext<VoiceManager | null>(null);

/** Voice lives as long as the online game session, so calls continue on the feed and friends pages. */
export function VoiceProvider({ children }: { children: ReactNode }) {
  const { engine, mode } = useWorldSession();
  const [manager, setManager] = useState<VoiceManager | null>(null);
  useEffect(() => {
    if (!engine || mode !== "online") return;
    const m = new VoiceManager(engine);
    setManager(m);
    return () => {
      m.dispose();
      setManager(null);
    };
  }, [engine, mode]);
  return <VoiceContext.Provider value={manager}>{children}</VoiceContext.Provider>;
}

export function useVoiceManager(): VoiceManager | null {
  return useContext(VoiceContext);
}

const OFF: VoiceState = { available: false, proximity: "off", muted: false, audioBlocked: false, call: null, notice: null };
const noop = () => () => undefined;

export function useVoiceState(manager: VoiceManager | null): VoiceState {
  return useSyncExternalStore(manager?.state.subscribe ?? noop, manager ? manager.state.get : () => OFF);
}
