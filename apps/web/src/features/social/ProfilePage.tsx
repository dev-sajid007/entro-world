import { useState } from "react";
import { Link, useParams } from "react-router";
import { ZONES, type UserProfile } from "@entroworld/shared";
import { Badge, Button, Card, Empty, ErrorText, Spinner, StatusDot, UserAvatar } from "../../components/ui";
import { ApiError, errorMessage } from "../../lib/api";
import { AppShell } from "./AppShell";
import { useProfile, useSocialAction, useUserFriends, useUserPosts } from "./hooks";
import { PostList, ReportForm } from "./Posts";
import styles from "./Social.module.css";

export default function ProfilePage() {
  const { username = "" } = useParams();
  const profile = useProfile(username);

  return (
    <AppShell>
      {profile.isLoading && <Spinner />}
      {profile.error && (
        <Empty>{profile.error instanceof ApiError && profile.error.status === 404 ? "This person doesn't exist or isn't available." : errorMessage(profile.error)}</Empty>
      )}
      {profile.data && <Profile profile={profile.data} />}
    </AppShell>
  );
}

function Profile({ profile }: { profile: UserProfile }) {
  const posts = useUserPosts(profile.user.id);
  const [tab, setTab] = useState<"posts" | "friends">("posts");
  const friends = useUserFriends(profile.user.id, tab === "friends" && !profile.restricted);
  const { user, relationship: rel } = profile;

  return (
    <>
      <Card>
        <div className={styles.profileHead}>
          <UserAvatar name={user.displayName} url={user.avatarUrl} size={72} />
          <div className={styles.postMeta}>
            <h1>{user.displayName}</h1>
            <span className={styles.muted}>
              @{user.username}
              {rel.followsYou && " · Follows you"}
            </span>
            {profile.online && (
              <span className={styles.online}>
                <StatusDot color="var(--success)" /> Online{profile.location ? ` in ${ZONES[profile.location.zoneId].name}` : ""}
              </span>
            )}
          </div>
          {rel.isSelf ? (
            <Link to="/settings">
              <Button variant="secondary">Edit profile</Button>
            </Link>
          ) : (
            <RelationshipActions profile={profile} />
          )}
        </div>
        {profile.bio && <p className={styles.body}>{profile.bio}</p>}
        {profile.restricted ? (
          <p className={styles.muted}>{rel.friendship === "blocked" ? "You blocked this person." : "This profile is private."}</p>
        ) : (
          <div className={styles.stats}>
            <span>
              <strong>{profile.stats.posts}</strong> posts
            </span>
            <span>
              <strong>{profile.stats.friends}</strong> friends
            </span>
            <span>
              <strong>{profile.stats.followers}</strong> followers
            </span>
            <span>
              <strong>{profile.stats.following}</strong> following
            </span>
          </div>
        )}
      </Card>

      {!profile.restricted && (
        <div className={styles.tabs} role="tablist">
          {(["posts", "friends"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`${styles.tab} ${tab === t ? styles.tabActive : ""}`} onClick={() => setTab(t)}>
              {t === "posts" ? "Posts" : "Friends"}
            </button>
          ))}
        </div>
      )}
      {tab === "posts" && <PostList query={posts} empty={profile.restricted ? "Posts are hidden." : "No posts yet."} />}
      {tab === "friends" && !profile.restricted && (
        <Card>
          {friends.isLoading && <Spinner />}
          {friends.error && <ErrorText>{errorMessage(friends.error)}</ErrorText>}
          {friends.data?.length === 0 && <Empty>No friends to show.</Empty>}
          <div className={styles.list}>
            {friends.data?.map((f) => (
              <Link key={f.id} to={`/u/${f.username}`} className={styles.person}>
                <UserAvatar name={f.displayName} url={f.avatarUrl} />
                <div className={styles.postMeta}>
                  <span className={styles.name}>{f.displayName}</span>
                  <span className={styles.muted}>@{f.username}</span>
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function RelationshipActions({ profile }: { profile: UserProfile }) {
  const action = useSocialAction();
  const [more, setMore] = useState<null | "menu" | "report" | "block">(null);
  const id = profile.user.id;
  const rel = profile.relationship;
  const run = (method: "POST" | "DELETE", path: string, body?: unknown) => action.mutate({ method, path, body });

  let primary = null;
  switch (rel.friendship) {
    case "none":
      primary = <Button onClick={() => run("POST", "/friends/requests", { userId: id })}>Add friend</Button>;
      break;
    case "pending_outgoing":
      primary = (
        <Button variant="secondary" onClick={() => rel.friendRequestId && run("DELETE", `/friends/requests/${rel.friendRequestId}`)}>
          Cancel request
        </Button>
      );
      break;
    case "pending_incoming":
      primary = (
        <>
          <Button onClick={() => rel.friendRequestId && run("POST", `/friends/requests/${rel.friendRequestId}/accept`)}>Accept request</Button>
          <Button variant="ghost" onClick={() => rel.friendRequestId && run("POST", `/friends/requests/${rel.friendRequestId}/reject`)}>
            Decline
          </Button>
        </>
      );
      break;
    case "friends":
      primary = <Badge>Friends</Badge>;
      break;
    case "blocked":
      primary = (
        <Button variant="secondary" onClick={() => run("DELETE", `/users/${id}/block`)}>
          Unblock
        </Button>
      );
      break;
    default:
      primary = null;
  }

  return (
    <div className={styles.row}>
      {primary}
      {rel.friendship !== "blocked" && (
        <Button variant="secondary" onClick={() => run(rel.following ? "DELETE" : "POST", `/users/${id}/follow`)}>
          {rel.following ? "Following" : "Follow"}
        </Button>
      )}
      <div className={styles.menu}>
        <Button variant="ghost" aria-label="More" onClick={() => setMore(more ? null : "menu")}>
          ⋯
        </Button>
        {more && (
          <div className={styles.menuList}>
            {more === "menu" && (
              <>
                {rel.friendship === "friends" && (
                  <button className={styles.menuItem} onClick={() => (setMore(null), run("DELETE", `/friends/${id}`))}>
                    Remove friend
                  </button>
                )}
                {rel.friendship !== "blocked" && (
                  <button className={`${styles.menuItem} ${styles.menuDanger}`} onClick={() => setMore("block")}>
                    Block
                  </button>
                )}
                <button className={styles.menuItem} onClick={() => setMore("report")}>
                  Report
                </button>
              </>
            )}
            {more === "block" && (
              <>
                <span className={styles.muted} style={{ padding: "6px 10px" }}>
                  Block {profile.user.displayName}? You won't see each other anywhere, and any friendship ends.
                </span>
                <button className={`${styles.menuItem} ${styles.menuDanger}`} onClick={() => (setMore(null), run("POST", `/users/${id}/block`))}>
                  Block
                </button>
                <button className={styles.menuItem} onClick={() => setMore(null)}>
                  Cancel
                </button>
              </>
            )}
            {more === "report" && <ReportForm path={`/users/${id}/report`} onDone={() => setMore(null)} />}
          </div>
        )}
      </div>
      {action.error && <ErrorText>{errorMessage(action.error)}</ErrorText>}
    </div>
  );
}
