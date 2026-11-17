import { useMemo, type ReactNode } from "react";
import type { PropertyView } from "@entroworld/shared";
import type { GameEngine } from "../../game/core/GameEngine";
import type { ScreenContent } from "../../game/scenes/Interactives";
import { WorldCanvas } from "./WorldCanvas";
import { Hud, type HudProps } from "./Hud";
import styles from "./WorldLayer.module.css";

export interface WorldLayerProps {
  engine: GameEngine;
  hudVisible: boolean;
  properties?: ReadonlyMap<string, PropertyView>;
  screen?: ScreenContent;
  renderPanel?: HudProps["renderPanel"];
  extras?: ReactNode;
  topRight?: ReactNode;
}

const EMPTY = new Map<string, PropertyView>();

/** The full-screen 3D world with its HUD. Stays mounted while social pages overlay it. */
export function WorldLayer({ engine, hudVisible, properties, screen, renderPanel, extras, topRight }: WorldLayerProps) {
  const screenContent = useMemo(() => screen ?? { title: "EntroWorld Live", subtitle: "No event scheduled right now" }, [screen]);
  return (
    <div className={styles.layer}>
      <WorldCanvas engine={engine} properties={properties ?? EMPTY} screen={screenContent} />
      {hudVisible && <Hud engine={engine} renderPanel={renderPanel} extras={extras} topRight={topRight} />}
    </div>
  );
}

export function WorldLoading({ text, error, onRetry }: { text: string; error?: string | null; onRetry?: () => void }) {
  return (
    <div className={styles.loading}>
      <div className={styles.loadingCard}>
        <div className={styles.logo}>EntroWorld</div>
        {error ? (
          <>
            <p className={styles.error}>{error}</p>
            {onRetry && (
              <button className={styles.retry} onClick={onRetry}>
                Try again
              </button>
            )}
          </>
        ) : (
          <>
            <div className={styles.bar}>
              <div className={styles.barFill} />
            </div>
            <p>{text}</p>
          </>
        )}
      </div>
    </div>
  );
}
