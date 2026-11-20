import { useDeferredValue, useState } from "react";
import { Link } from "react-router";
import { Card, Empty, ErrorText, Spinner, UserAvatar } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { useVoiceManager, useVoiceState } from "../voice/VoiceContext";
import { AppShell, timeAgo } from "./AppShell";
import { useFriendRequests, useFriends, useSocialAction, useUserSearch } from "./hooks";
import { FriendsIcon, PhoneIcon, SearchIcon, SendIcon, UserPlusIcon } from "./Icons";
import { FriendTile } from "./ProfilePage";
import { MeItem, SideItem } from "./Sidebar";
import styles from "./Social.module.css";

type View = "home" | "requests" | "all" | "find";
const VIEWS: { id: View; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "requests", label: "Requests" },
  { id: "all", label: "All" },
  { id: "find", label: "Find" },
];

export default function FriendsPage() {
  const friends = useFriends();
  const requests = useFriendRequests();
  const action = useSocialAction();
  const [view, setView] = useState<View>("home");
  const [q, setQ] = useState("");
  const search = useUserSearch(useDeferredValue(q));
  const voice = useVoiceManager();
  const voiceState = useVoiceState(voice);
  const incoming = requests.data?.incoming ?? [];
  const outgoing = requests.data?.outgoing ?? [];
  const all = [...(friends.data ?? [])].sort((a, b) => Number(b.online) - Number(a.online) || a.displayName.localeCompare(b.displayName));
  const onlineCount = all.filter((f) => f.online).length;

  const act = (method: "POST" | "DELETE", path: string) => action.mutate({ method, path }, { onSuccess: () => void requests.refetch() });

  const left = (
    <nav className={styles.sideNav} aria-label="Friends">
      <h2 className={styles.sideTitle}>Friends</h2>
      <SideItem icon={<FriendsIcon />} label="Home" active={view === "home"} onClick={() => setView("home")} />
      <SideItem icon={<UserPlusIcon />} label={`Friend requests${incoming.length ? ` (${incoming.length})` : ""}`} active={view === "requests"} onClick={() => setView("requests")} />
      <SideItem icon={<FriendsIcon />} label="All friends" active={view === "all"} onClick={() => setView("all")} />
      <SideItem icon={<SearchIcon />} label="Find people" active={view === "find"} onClick={() => setView("find")} />
      <div className={styles.menuSep} />
      <MeItem />
    </nav>
  );

  const requestsSection = (
    <Card>
      <div className={styles.sideHead}>
        <h2 className={styles.sectionTitle}>Friend requests {incoming.length > 0 && <span className={styles.tabCount}>{incoming.length}</span>}</h2>
        {view === "home" && incoming.length > 3 && (
          <button className={styles.sideLink} onClick={() => setView("requests")}>
            See all
          </button>
        )}
      </div>
      {requests.isLoading && <Spinner />}
      {requests.data && incoming.length === 0 && <Empty>No new requests.</Empty>}
      <div className={styles.tileGrid}>
        {(view === "home" ? incoming.slice(0, 6) : incoming).map((r) => (
          <FriendTile key={r.id} friend={r.from}>
            <span className={styles.faint}>{timeAgo(r.createdAt)}</span>
            <button className={styles.pillPrimary} disabled={action.isPending} onClick={() => act("POST", `/friends/requests/${r.id}/accept`)}>
              Confirm
            </button>
            <button className={styles.pillSecondary} disabled={action.isPending} onClick={() => act("POST", `/friends/requests/${r.id}/reject`)}>
              Delete
            </button>
          </FriendTile>
        ))}
      </div>
      {outgoing.length > 0 && (view === "requests" || view === "home") && (
        <>
          <h3 className={styles.subTitle}>
            <SendIcon size={15} /> Sent requests
          </h3>
          <div className={styles.list}>
            {outgoing.map((r) => (
              <div key={r.id} className={styles.person}>
                <FriendRow user={r.to} sub={`Sent ${timeAgo(r.createdAt)}`} />
                <button className={styles.pillSecondary} disabled={action.isPending} onClick={() => act("DELETE", `/friends/requests/${r.id}`)}>
                  Cancel
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );

  const friendsSection = (
    <Card>
      <div className={styles.sideHead}>
        <div>
          <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
            All friends
          </h2>
          {all.length > 0 && (
            <span className={styles.faint}>
              {all.length} friends · {onlineCount} online
            </span>
          )}
        </div>
      </div>
      {friends.isLoading && <Spinner />}
      {friends.error && <ErrorText>{errorMessage(friends.error)}</ErrorText>}
      {friends.data?.length === 0 && (
        <Empty>
          No friends yet.{" "}
          <button className={styles.textBtn} onClick={() => setView("find")}>
            Find people to add
          </button>
        </Empty>
      )}
      <div className={styles.tileGrid}>
        {all.map((f) => (
          <FriendTile key={f.id} friend={f}>
            {/* Calls need both people in the city (the voice session runs with the world). */}
            {f.online && voice && voiceState.available ? (
              <button className={styles.pillSecondary} disabled={voiceState.call !== null} onClick={() => void voice.call(f)} aria-label={`Voice call ${f.displayName}`}>
                <PhoneIcon size={14} /> Call
              </button>
            ) : (
              <Link to={`/u/${f.username}`} className={styles.pillSecondary}>
                View profile
              </Link>
            )}
          </FriendTile>
        ))}
      </div>
    </Card>
  );

  const findSection = (
    <Card>
      <h2 className={styles.sectionTitle}>Find people</h2>
      <div className={styles.searchBox}>
        <SearchIcon size={17} />
        <input
          autoFocus={view === "find"}
          placeholder="Search by name or @username"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label="Search people"
        />
      </div>
      {search.isFetching && <Spinner />}
      {search.data?.length === 0 && q.trim() && <Empty>Nobody found.</Empty>}
      <div className={styles.tileGrid} style={{ marginTop: 12 }}>
        {search.data?.map((u) => (
          <FriendTile key={u.id} friend={u}>
            <Link to={`/u/${u.username}`} className={styles.pillPrimary}>
              View profile
            </Link>
          </FriendTile>
        ))}
      </div>
    </Card>
  );

  return (
    <AppShell left={left}>
      <div className={`${styles.feedTabs} ${styles.mobileOnly}`} role="tablist">
        {VIEWS.map((v) => (
          <button key={v.id} role="tab" aria-selected={view === v.id} className={`${styles.feedTab} ${view === v.id ? styles.feedTabOn : ""}`} onClick={() => setView(v.id)}>
            {v.label}
            {v.id === "requests" && incoming.length > 0 && <span className={styles.tabCount}>{incoming.length}</span>}
          </button>
        ))}
      </div>
      {action.error && <ErrorText>{errorMessage(action.error)}</ErrorText>}
      {view === "home" && (
        <>
          {requestsSection}
          {friendsSection}
        </>
      )}
      {view === "requests" && requestsSection}
      {view === "all" && friendsSection}
      {view === "find" && findSection}
    </AppShell>
  );
}

function FriendRow({ user, sub }: { user: { username: string; displayName: string; avatarUrl: string | null }; sub: string }) {
  return (
    <Link to={`/u/${user.username}`} className={styles.contactLink}>
      <UserAvatar name={user.displayName} url={user.avatarUrl} size={40} />
      <span className={styles.postMeta}>
        <span className={styles.name}>{user.displayName}</span>
        <span className={styles.faint}>{sub}</span>
      </span>
    </Link>
  );
}
