import { useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { ZONES, type FriendView, type PublicUser, type UserProfile, type ZoneId } from "@entroworld/shared";
import { Button, Card, Empty, ErrorText, Spinner, UserAvatar } from "../../components/ui";
import { ApiError, errorMessage } from "../../lib/api";
import { AppShell, useClickOutside } from "./AppShell";
import { useProfile, useSocialAction, useUserAcademy, useUserFriends, useUserPosts } from "./hooks";
import { CalendarIcon, CheckIcon, FriendsIcon, GlobeIcon, LockIcon, MoreIcon, PinIcon, TrophyIcon, UserPlusIcon } from "./Icons";
import { Composer, PostList, ReportForm } from "./Posts";
import styles from "./Social.module.css";

export default function ProfilePage() {
  const { username = "" } = useParams();
  const profile = useProfile(username);

  return (
    <AppShell wide>
      {profile.isLoading && <Spinner />}
      {profile.error && (
        <Card>
          <Empty>{profile.error instanceof ApiError && profile.error.status === 404 ? "This person doesn't exist or isn't available." : errorMessage(profile.error)}</Empty>
        </Card>
      )}
      {profile.data && <Profile key={profile.data.user.id} profile={profile.data} />}
    </AppShell>
  );
}

/** A stable two-colour gradient per user, used when there's no cover photo. */
function coverGradient(seed: string) {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 42%), hsl(${(h + 60) % 360} 72% 34%) 55%, hsl(${(h + 140) % 360} 60% 22%))`;
}

type Tab = "posts" | "about" | "friends";

function Profile({ profile }: { profile: UserProfile }) {
  const [tab, setTab] = useState<Tab>("posts");
  const { user, relationship: rel } = profile;
  const visible = !profile.restricted;
  const posts = useUserPosts(user.id);
  const friends = useUserFriends(user.id, visible);
  const mutual = rel.friendship === "friends" ? "Friends" : rel.followsYou ? "Follows you" : null;

  return (
    <>
      <Card className={styles.hero}>
        <div className={styles.cover} style={profile.coverUrl ? { backgroundImage: `url(${profile.coverUrl})` } : { background: coverGradient(user.username) }} />
        <div className={styles.heroBody}>
          <div className={styles.heroAvatar}>
            <UserAvatar name={user.displayName} url={user.avatarUrl} size={148} />
            {profile.online && <span className={`${styles.presence} ${styles.presenceBig}`} title="Online" />}
          </div>
          <div className={styles.heroInfo}>
            <h1>{user.displayName}</h1>
            <span className={styles.muted}>
              @{user.username}
              {mutual && <span className={styles.relPill}>{mutual}</span>}
            </span>
            {visible && (
              <div className={styles.heroStats}>
                <button onClick={() => setTab("friends")}>
                  <strong>{profile.stats.friends}</strong> friends
                </button>
                <span>
                  <strong>{profile.stats.followers}</strong> followers
                </span>
                <span>
                  <strong>{profile.stats.following}</strong> following
                </span>
                <span>
                  <strong>{profile.stats.posts}</strong> posts
                </span>
              </div>
            )}
            {visible && friends.data && friends.data.length > 0 && (
              <div className={styles.stack} aria-hidden>
                {friends.data.slice(0, 8).map((f) => (
                  <span key={f.id} className={styles.stackItem}>
                    <UserAvatar name={f.displayName} url={f.avatarUrl} size={30} />
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className={styles.heroActions}>
            {rel.isSelf ? (
              <Link to="/settings">
                <Button variant="secondary">Edit profile</Button>
              </Link>
            ) : (
              <RelationshipActions profile={profile} />
            )}
          </div>
        </div>
        {visible && (
          <div className={styles.profileTabs} role="tablist">
            {(["posts", "about", "friends"] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={`${styles.profileTab} ${tab === t ? styles.profileTabOn : ""}`} onClick={() => setTab(t)}>
                {t === "posts" ? "Posts" : t === "about" ? "About" : "Friends"}
                {t === "friends" && <span className={styles.tabCount}>{profile.stats.friends}</span>}
              </button>
            ))}
          </div>
        )}
      </Card>

      {!visible ? (
        <Card>
          <div className={styles.locked}>
            <LockIcon size={34} />
            <h2>{rel.friendship === "blocked" ? "You blocked this person" : "This profile is private"}</h2>
            <p className={styles.muted}>{rel.friendship === "blocked" ? "Unblock them to see their profile again." : "Add them as a friend to see their posts and details."}</p>
          </div>
        </Card>
      ) : tab === "posts" ? (
        <div className={styles.profileGrid}>
          <div className={styles.profileSide}>
            <IntroCard profile={profile} />
            <AcademyCard userId={user.id} isSelf={rel.isSelf} />
            <FriendsPreview friends={friends.data} total={profile.stats.friends} onAll={() => setTab("friends")} />
          </div>
          <div className={styles.profileMain}>
            {rel.isSelf && <Composer />}
            <PostList query={posts} empty={rel.isSelf ? "You haven't posted yet. Share your first update!" : "No posts yet."} />
          </div>
        </div>
      ) : tab === "about" ? (
        <div className={styles.profileGrid}>
          <div className={styles.profileSide}>
            <IntroCard profile={profile} />
          </div>
          <div className={styles.profileMain}>
            <AcademyCard userId={user.id} isSelf={rel.isSelf} />
          </div>
        </div>
      ) : (
        <Card>
          <h2 className={styles.sectionTitle}>Friends</h2>
          {friends.isLoading && <Spinner />}
          {friends.error && <ErrorText>{errorMessage(friends.error)}</ErrorText>}
          {friends.data?.length === 0 && <Empty>No friends to show.</Empty>}
          <div className={styles.tileGrid}>
            {friends.data?.map((f) => (
              <FriendTile key={f.id} friend={f} />
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function IntroCard({ profile }: { profile: UserProfile }) {
  const privacy = { public: { icon: <GlobeIcon size={18} />, label: "Public profile" }, friends: { icon: <FriendsIcon size={18} />, label: "Visible to friends" }, private: { icon: <LockIcon size={18} />, label: "Private profile" } }[profile.privacy];
  return (
    <Card>
      <h2 className={styles.sectionTitle}>Intro</h2>
      {profile.bio ? <p className={styles.introBio}>{profile.bio}</p> : profile.relationship.isSelf && <p className={styles.faint}>Add a short bio in Settings so people know who you are.</p>}
      <ul className={styles.facts}>
        {profile.online && (
          <li>
            <PinIcon size={18} />
            <span>
              Online now{profile.location ? <> in <strong>{ZONES[profile.location.zoneId].name}</strong></> : null}
            </span>
          </li>
        )}
        <li>
          <CalendarIcon size={18} />
          <span>Joined {new Date(profile.createdAt).toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        </li>
        <li>
          {privacy.icon}
          <span>{privacy.label}</span>
        </li>
      </ul>
      {profile.relationship.isSelf && (
        <Link to="/settings" className={styles.fullBtn}>
          Edit details
        </Link>
      )}
    </Card>
  );
}

function FriendsPreview({ friends, total, onAll }: { friends: FriendView[] | undefined; total: number; onAll: () => void }) {
  if (!friends || friends.length === 0) return null;
  return (
    <Card>
      <div className={styles.sideHead}>
        <div>
          <h2 className={styles.sectionTitle} style={{ margin: 0 }}>
            Friends
          </h2>
          <span className={styles.faint}>{total} friends</span>
        </div>
        <button className={styles.sideLink} onClick={onAll}>
          See all
        </button>
      </div>
      <div className={styles.miniGrid}>
        {friends.slice(0, 9).map((f) => (
          <Link key={f.id} to={`/u/${f.username}`} className={styles.miniTile}>
            <span className={styles.miniAvatar}>
              <UserAvatar name={f.displayName} url={f.avatarUrl} size={88} />
            </span>
            <span className={styles.miniName}>{f.displayName}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

export function FriendTile({ friend, children }: { friend: PublicUser & { online?: boolean; zoneId?: ZoneId | null }; children?: ReactNode }) {
  return (
    <div className={styles.tile}>
      <Link to={`/u/${friend.username}`} className={styles.tileTop}>
        <span className={styles.avatarWrap}>
          <UserAvatar name={friend.displayName} url={friend.avatarUrl} size={84} />
          {friend.online && <span className={`${styles.presence} ${styles.presenceMd}`} />}
        </span>
        <span className={styles.name}>{friend.displayName}</span>
        <span className={styles.faint}>{friend.online && friend.zoneId ? `In ${ZONES[friend.zoneId].name}` : `@${friend.username}`}</span>
      </Link>
      {children && <div className={styles.tileActions}>{children}</div>}
    </div>
  );
}

/** Coding Academy level and badges (SPEC-ADDENDUM-01 §3.3 "Badges shown on user profile"). */
function AcademyCard({ userId, isSelf }: { userId: string; isSelf: boolean }) {
  const academy = useUserAcademy(userId, true);
  const a = academy.data;
  if (!a || (a.lessonsCompleted === 0 && !isSelf)) return null;
  return (
    <Card>
      <div className={styles.academyHead}>
        <h2>
          <TrophyIcon size={18} /> Coding Academy
        </h2>
        <span className={styles.levelPill}>Lv {a.level}</span>
      </div>
      <p className={styles.muted} style={{ margin: "6px 0 0" }}>
        {a.totalXp} XP · {a.lessonsCompleted} puzzle{a.lessonsCompleted === 1 ? "" : "s"} solved
      </p>
      {a.badges.length > 0 ? (
        <div className={styles.academyBadges}>
          {a.badges.map((b) => (
            <span key={b.slug} className={styles.academyBadge} title={b.description}>
              🏅 {b.name}
            </span>
          ))}
        </div>
      ) : (
        <p className={styles.faint}>No badges yet. Solve puzzles in the Puzzle Lab to earn some!</p>
      )}
    </Card>
  );
}

function RelationshipActions({ profile }: { profile: UserProfile }) {
  const action = useSocialAction();
  const [more, setMore] = useState<null | "menu" | "report" | "block">(null);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, more !== null, () => setMore(null));
  const id = profile.user.id;
  const rel = profile.relationship;
  const busy = action.isPending;
  const run = (method: "POST" | "DELETE", path: string, body?: unknown) => action.mutate({ method, path, body });

  let primary = null;
  switch (rel.friendship) {
    case "none":
      primary = (
        <Button disabled={busy} onClick={() => run("POST", "/friends/requests", { userId: id })}>
          <UserPlusIcon size={18} /> Add friend
        </Button>
      );
      break;
    case "pending_outgoing":
      primary = (
        <Button variant="secondary" disabled={busy} onClick={() => rel.friendRequestId && run("DELETE", `/friends/requests/${rel.friendRequestId}`)}>
          Cancel request
        </Button>
      );
      break;
    case "pending_incoming":
      primary = (
        <>
          <Button disabled={busy} onClick={() => rel.friendRequestId && run("POST", `/friends/requests/${rel.friendRequestId}/accept`)}>
            Confirm request
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => rel.friendRequestId && run("POST", `/friends/requests/${rel.friendRequestId}/reject`)}>
            Delete
          </Button>
        </>
      );
      break;
    case "friends":
      primary = (
        <Button variant="secondary" disabled>
          <CheckIcon size={18} /> Friends
        </Button>
      );
      break;
    case "blocked":
      primary = (
        <Button variant="secondary" disabled={busy} onClick={() => run("DELETE", `/users/${id}/block`)}>
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
        <Button variant="secondary" disabled={busy} onClick={() => run(rel.following ? "DELETE" : "POST", `/users/${id}/follow`)}>
          {rel.following ? "Following" : "Follow"}
        </Button>
      )}
      <div className={styles.menu} ref={ref}>
        <Button variant="secondary" aria-label="More" onClick={() => setMore(more ? null : "menu")}>
          <MoreIcon size={18} />
        </Button>
        {more && (
          <div className={styles.menuList}>
            {more === "menu" && (
              <>
                {rel.friendship === "friends" && (
                  <button className={styles.menuItem} onClick={() => (setMore(null), run("DELETE", `/friends/${id}`))}>
                    Unfriend
                  </button>
                )}
                {rel.friendship !== "blocked" && (
                  <button className={`${styles.menuItem} ${styles.menuDanger}`} onClick={() => setMore("block")}>
                    Block
                  </button>
                )}
                <button className={styles.menuItem} onClick={() => setMore("report")}>
                  Report profile
                </button>
              </>
            )}
            {more === "block" && (
              <>
                <span className={styles.menuNote}>Block {profile.user.displayName}? You won't see each other anywhere, and any friendship ends.</span>
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
