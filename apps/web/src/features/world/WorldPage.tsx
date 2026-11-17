import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { Link, useNavigate } from "react-router";
import type { WorldJoinResponse, ZoneId } from "@entroworld/shared";
import { api } from "../../lib/api";
import { useAuth, useCurrentUser } from "../auth/AuthContext";
import { useBlocked, useMyAvatar, useZonePosts } from "../social/hooks";
import { Composer, PostList } from "../social/Posts";
import socialStyles from "../social/Social.module.css";
import type { GameEngine } from "../../game/core/GameEngine";
import { PanelHeader, type PanelRequest } from "./Hud";
import { useWorldSession } from "./WorldSession";
import { WorldLayer, WorldLoading } from "./WorldLayer";

const requestTicket = (zoneId?: ZoneId) => api.post<WorldJoinResponse>("/worlds/join", zoneId ? { zoneId } : {});

/**
 * The online city for signed-in users. The session outlives this page: visiting the feed or a
 * profile keeps the player in the world, and coming back resumes instantly.
 */
export default function WorldPage() {
  const me = useCurrentUser();
  const session = useWorldSession();
  const avatar = useMyAvatar();
  const blocked = useBlocked();
  const blockedIds = useRef(new Set<string>());
  const { start } = session;

  useEffect(() => {
    blockedIds.current = new Set(blocked.data?.map((u) => u.id) ?? []);
  }, [blocked.data]);

  const enter = useCallback(() => {
    if (!avatar.data) return;
    void start({
      mode: "online",
      userId: me.id,
      username: me.username,
      displayName: me.displayName,
      avatar: avatar.data,
      requestTicket,
      isBlocked: (id) => blockedIds.current.has(id),
    });
  }, [start, me.id, me.username, me.displayName, avatar.data]);

  const ours = session.mode === "online" && session.userId === me.id;
  const needsStart = !ours && session.status !== "loading" && session.status !== "error";
  useEffect(() => {
    if (needsStart) enter();
  }, [needsStart, enter]);

  if (avatar.error) return <WorldLoading text="" error="Could not load your avatar." onRetry={() => void avatar.refetch()} />;
  if (session.status === "error") return <WorldLoading text="" error={session.error} onRetry={enter} />;
  if (!session.engine || !ours) return <WorldLoading text="Connecting to the city…" />;
  return <OnlineWorld engine={session.engine} onRejoin={enter} />;
}

function OnlineWorld({ engine, onRejoin }: { engine: GameEngine; onRejoin: () => void }) {
  const ui = useSyncExternalStore(engine.ui.subscribe, engine.ui.get);
  const renderPanel = useCallback((panel: PanelRequest, close: () => void) => {
    if (panel.kind === "board") return <BoardPanel panel={panel} onClose={close} />;
    return (
      <div>
        <PanelHeader title={panel.object.label} onClose={close} />
        <p className={socialStyles.muted}>Coming soon to the city.</p>
      </div>
    );
  }, []);

  if (ui.status === "disconnected" && ui.error) return <WorldLoading text="" error={ui.error} onRetry={onRejoin} />;
  return <WorldLayer engine={engine} hudVisible renderPanel={renderPanel} topRight={<HudNav />} />;
}

function HudNav() {
  const me = useCurrentUser();
  const { logout } = useAuth();
  const { stop } = useWorldSession();
  const navigate = useNavigate();
  const signOut = async () => {
    await stop();
    await logout();
    navigate("/", { replace: true });
  };
  return (
    <nav className={socialStyles.hudNav} aria-label="Main">
      <Link to="/feed" className={socialStyles.hudLink}>
        Feed
      </Link>
      <Link to="/friends" className={socialStyles.hudLink}>
        Friends
      </Link>
      <Link to={`/u/${me.username}`} className={socialStyles.hudLink}>
        Profile
      </Link>
      <button className={socialStyles.hudLink} onClick={() => void signOut()}>
        Sign out
      </button>
    </nav>
  );
}

/** Notice boards show posts pinned to their district, and let players pin new ones. */
function BoardPanel({ panel, onClose }: { panel: PanelRequest; onClose: () => void }) {
  const o = panel.object;
  const posts = useZonePosts(o.zoneId);
  return (
    <div className={socialStyles.board}>
      <PanelHeader title={o.label} subtitle="Notes pinned to this district" onClose={onClose} />
      <Composer location={{ zoneId: o.zoneId, x: o.x, y: 0, z: o.z }} placeholder="Pin a note for people passing by…" />
      <PostList query={posts} empty="Nothing pinned here yet." />
    </div>
  );
}
