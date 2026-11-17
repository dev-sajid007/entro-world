import { useDeferredValue, useState } from "react";
import { Link } from "react-router";
import { ZONES, type PublicUser } from "@entroworld/shared";
import { Button, Card, Empty, ErrorText, Input, Spinner, StatusDot, UserAvatar } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { useVoiceManager, useVoiceState } from "../voice/VoiceContext";
import { AppShell, timeAgo } from "./AppShell";
import { useFriendRequests, useFriends, useSocialAction, useUserSearch } from "./hooks";
import styles from "./Social.module.css";

function Person({ user, children, sub }: { user: PublicUser; children?: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className={styles.person}>
      <Link to={`/u/${user.username}`}>
        <UserAvatar name={user.displayName} url={user.avatarUrl} />
      </Link>
      <div className={styles.postMeta}>
        <Link to={`/u/${user.username}`} className={styles.name}>
          {user.displayName}
        </Link>
        <span className={styles.muted}>{sub ?? `@${user.username}`}</span>
      </div>
      {children}
    </div>
  );
}

export default function FriendsPage() {
  const friends = useFriends();
  const requests = useFriendRequests();
  const action = useSocialAction();
  const [q, setQ] = useState("");
  const search = useUserSearch(useDeferredValue(q));
  const online = friends.data?.filter((f) => f.online) ?? [];
  const offline = friends.data?.filter((f) => !f.online) ?? [];
  const voice = useVoiceManager();
  const voiceState = useVoiceState(voice);

  const act = (method: "POST" | "DELETE", path: string, body?: unknown) =>
    action.mutate({ method, path, body }, { onSuccess: () => void requests.refetch() });

  return (
    <AppShell wide>
      <h1 className={styles.pageTitle}>Friends</h1>
      {action.error && <ErrorText>{errorMessage(action.error)}</ErrorText>}
      <div className={styles.grid}>
        <Card>
          <h2 className={styles.sectionTitle}>Your friends</h2>
          {friends.isLoading && <Spinner />}
          {friends.error && <ErrorText>{errorMessage(friends.error)}</ErrorText>}
          {friends.data?.length === 0 && <Empty>No friends yet. Search for people to add.</Empty>}
          <div className={styles.list}>
            {[...online, ...offline].map((f) => (
              <Person
                key={f.id}
                user={f}
                sub={
                  f.online ? (
                    <span className={styles.online}>
                      <StatusDot color="var(--success)" /> {f.zoneId ? ZONES[f.zoneId].name : "Online"}
                    </span>
                  ) : (
                    `@${f.username}`
                  )
                }
              >
                {/* Calls need both people in the city (the voice session runs with the world). */}
                {f.online && voice && voiceState.available && (
                  <Button size="small" variant="ghost" disabled={voiceState.call !== null} onClick={() => void voice.call(f)} aria-label={`Voice call ${f.displayName}`}>
                    📞 Call
                  </Button>
                )}
              </Person>
            ))}
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card>
            <h2 className={styles.sectionTitle}>Requests</h2>
            {requests.isLoading && <Spinner />}
            {requests.data && requests.data.incoming.length === 0 && requests.data.outgoing.length === 0 && <Empty>No pending requests.</Empty>}
            <div className={styles.list}>
              {requests.data?.incoming.map((r) => (
                <Person key={r.id} user={r.from} sub={`Wants to be friends · ${timeAgo(r.createdAt)}`}>
                  <Button size="small" onClick={() => act("POST", `/friends/requests/${r.id}/accept`)}>
                    Accept
                  </Button>
                  <Button size="small" variant="ghost" onClick={() => act("POST", `/friends/requests/${r.id}/reject`)}>
                    Decline
                  </Button>
                </Person>
              ))}
              {requests.data?.outgoing.map((r) => (
                <Person key={r.id} user={r.to} sub={`Request sent · ${timeAgo(r.createdAt)}`}>
                  <Button size="small" variant="ghost" onClick={() => act("DELETE", `/friends/requests/${r.id}`)}>
                    Cancel
                  </Button>
                </Person>
              ))}
            </div>
          </Card>

          <Card>
            <h2 className={styles.sectionTitle}>Find people</h2>
            <Input placeholder="Search by name or @username" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search people" />
            {search.isFetching && <Spinner />}
            {search.data?.length === 0 && q.trim() && <Empty>Nobody found.</Empty>}
            <div className={styles.list}>
              {search.data?.map((u) => (
                <Person key={u.id} user={u}>
                  <Link to={`/u/${u.username}`}>
                    <Button size="small" variant="secondary">
                      View
                    </Button>
                  </Link>
                </Person>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
