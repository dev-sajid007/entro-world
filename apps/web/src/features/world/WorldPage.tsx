import { Suspense, lazy, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router";
import type { WorldJoinResponse, ZoneId } from "@entroworld/shared";
import { api } from "../../lib/api";
import { useAuth, useCurrentUser } from "../auth/AuthContext";
import { useBlocked, useMyAvatar, useZonePosts } from "../social/hooks";
import { Composer, PostList } from "../social/Posts";
import socialStyles from "../social/Social.module.css";
import { shopQuery } from "../market/hooks";
import { ShopPanel } from "../market/ShopPanel";
import { socialKeys } from "../academy/hooks";
import { VoiceControls } from "../voice/VoiceControls";
import type { GameEngine } from "../../game/core/GameEngine";
import { PanelHeader, type PanelRequest } from "./Hud";
import { useWorldSession } from "./WorldSession";
import { WorldLayer, WorldLoading } from "./WorldLayer";

// Blockly is large; it loads the first time someone opens the Puzzle Lab console.
const AcademyPanel = lazy(() => import("../academy/AcademyPanel"));
const ClassPanel = lazy(() => import("../academy/ClassPanel"));

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
  useShopGreetings(engine);
  useAcademyInvites(engine);
  const renderPanel = useCallback((panel: PanelRequest, close: () => void) => {
    if (panel.kind === "board") return <BoardPanel panel={panel} onClose={close} />;
    if (panel.kind === "shopkeeper" && panel.object.ref) return <ShopPanel shopSlug={panel.object.ref} onClose={close} />;
    if (panel.kind === "academyLab") {
      return (
        <Suspense fallback={<PanelHeader title="Puzzle Lab" subtitle="Starting the console…" onClose={close} />}>
          <AcademyPanel onClose={close} />
        </Suspense>
      );
    }
    if (panel.kind === "screen") {
      return (
        <Suspense fallback={<PanelHeader title={panel.object.label} subtitle="Loading…" onClose={close} />}>
          <ClassPanel engine={engine} screen={panel.object} onClose={close} />
        </Suspense>
      );
    }
    return (
      <div>
        <PanelHeader title={panel.object.label} onClose={close} />
        <p className={socialStyles.muted}>Coming soon to the city.</p>
      </div>
    );
  }, [engine]);

  if (ui.status === "disconnected" && ui.error) return <WorldLoading text="" error={ui.error} onRetry={onRejoin} />;
  return <WorldLayer engine={engine} hudVisible renderPanel={renderPanel} topRight={<HudNav />} extras={<VoiceControls />} />;
}

/** A friend's invitation to pair up or battle shows as a toast; the Puzzle Lab console lists it. */
function useAcademyInvites(engine: GameEngine) {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      engine.events.on("academyInvite", (invite) => {
        void queryClient.invalidateQueries({ queryKey: socialKeys.invites });
        const what = invite.kind === "pair" ? "pair up" : "a coding battle";
        engine.events.emit("system", `${invite.from.displayName} invited you to ${what} on “${invite.lessonTitle}”. Open a Puzzle Lab console at the Coding Academy to join.`);
      }),
    [engine, queryClient],
  );
}

/** The shopkeeper greets the player (in a speech bubble only they see) when they step up to the counter. */
function useShopGreetings(engine: GameEngine) {
  const queryClient = useQueryClient();
  useEffect(
    () =>
      engine.events.on("shopEnter", ({ shopSlug, agentId }) => {
        void queryClient
          .fetchQuery(shopQuery(shopSlug))
          .then((shop) => {
            if (engine.ui.get().shop?.shopSlug !== shopSlug || !shop.agent) return;
            engine.shopkeeper(agentId)?.say(shop.agent.greeting, performance.now(), 9000);
          })
          .catch(() => undefined);
      }),
    [engine, queryClient],
  );
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
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <nav className={socialStyles.hudNav} data-open={open || undefined} aria-label="Main">
      {/* On phones the links fold into a menu button. */}
      <button className={`${socialStyles.hudLink} ${socialStyles.hudMenu}`} aria-expanded={open} aria-label="Menu" onClick={() => setOpen((o) => !o)}>
        {open ? "✕" : "☰"}
      </button>
      <div className={socialStyles.hudLinks}>
        <Link to="/feed" className={socialStyles.hudLink} onClick={close}>
          Feed
        </Link>
        <Link to="/friends" className={socialStyles.hudLink} onClick={close}>
          Friends
        </Link>
        <Link to={`/u/${me.username}`} className={socialStyles.hudLink} onClick={close}>
          Profile
        </Link>
        <button className={socialStyles.hudLink} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
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
