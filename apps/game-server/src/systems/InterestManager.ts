import type { StateView } from "@colyseus/schema";
import { NETWORK } from "@entroworld/shared";

interface Positioned {
  x: number;
  z: number;
}

interface Viewer {
  sessionId: string;
  view?: StateView | undefined;
}

/**
 * Nearby-player visibility. Each client's StateView contains only the players within
 * `radius` of it (plus `hysteresis` before removal, so players at the edge don't flicker).
 */
export class InterestManager<P extends Positioned & object> {
  constructor(
    readonly radius: number = NETWORK.viewRadius,
    readonly hysteresis: number = 15,
  ) {}

  /** Updates one viewer. Returns the number of players added and removed. */
  updateViewer(viewer: Viewer, players: ReadonlyMap<string, P>): { added: number; removed: number } {
    const view = viewer.view;
    const self = players.get(viewer.sessionId);
    if (!view || !self) return { added: 0, removed: 0 };
    let added = 0;
    let removed = 0;
    const enter = this.radius * this.radius;
    const leave = (this.radius + this.hysteresis) ** 2;
    for (const [sessionId, other] of players) {
      const visible = view.has(other as never);
      if (sessionId === viewer.sessionId) {
        if (!visible) {
          view.add(other as never);
          added++;
        }
        continue;
      }
      const dx = other.x - self.x;
      const dz = other.z - self.z;
      const d2 = dx * dx + dz * dz;
      if (!visible && d2 <= enter) {
        view.add(other as never);
        added++;
      } else if (visible && d2 > leave) {
        view.remove(other as never);
        removed++;
      }
    }
    return { added, removed };
  }

  updateAll(viewers: Iterable<Viewer>, players: ReadonlyMap<string, P>): void {
    for (const viewer of viewers) this.updateViewer(viewer, players);
  }
}
