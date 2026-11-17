import { useEffect, useState } from "react";
import { generateAvatar } from "@entroworld/avatar";
import type { WorldJoinResponse, ZoneId } from "@entroworld/shared";
import { useWorldSession } from "./WorldSession";
import { WorldLayer, WorldLoading } from "./WorldLayer";

interface GuestIdentity {
  username: string;
  displayName: string;
}

/** One guest per browser tab (sessionStorage), stable across reloads of that tab. */
function guestIdentity(): GuestIdentity {
  const key = "ew:dev-guest";
  try {
    const saved = sessionStorage.getItem(key);
    if (saved) return JSON.parse(saved) as GuestIdentity;
  } catch {
    // Storage unavailable: fall through to a fresh identity.
  }
  const n = Math.floor(1000 + Math.random() * 9000);
  const identity = { username: `guest${n}`, displayName: `Guest ${n}` };
  try {
    sessionStorage.setItem(key, JSON.stringify(identity));
  } catch {
    // Not persisted; the next reload gets a new guest.
  }
  return identity;
}

async function requestDevTicket(identity: GuestIdentity, zoneId?: ZoneId): Promise<WorldJoinResponse> {
  const res = await fetch("/game/dev/ticket", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(zoneId ? { ...identity, zoneId } : identity),
  });
  if (!res.ok) throw new Error(res.status === 404 ? "Dev tickets are disabled on the game server (set GAME_DEV_TICKETS=true)." : `Ticket request failed (${res.status})`);
  return (await res.json()) as WorldJoinResponse;
}

/**
 * Development only (Milestone 2): joins the shared multiplayer world as a guest, using tickets from
 * the game server's /dev/ticket endpoint instead of an account. Open it in two tabs to see each other.
 */
export default function DevMultiplayerPage() {
  const session = useWorldSession();
  const { start, stop } = session;
  const [identity] = useState(guestIdentity);

  useEffect(() => {
    void start({
      mode: "online",
      userId: null,
      username: identity.username,
      displayName: identity.displayName,
      avatar: generateAvatar(identity.username),
      requestTicket: (zoneId) => requestDevTicket(identity, zoneId),
    });
    return () => void stop();
  }, [start, stop, identity]);

  if (session.status === "error") return <WorldLoading text="" error={session.error} onRetry={() => window.location.reload()} />;
  if (!session.engine || session.mode !== "online") return <WorldLoading text="Connecting to the city…" />;
  return <WorldLayer engine={session.engine} hudVisible />;
}
