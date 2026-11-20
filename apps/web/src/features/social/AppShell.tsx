import { useDeferredValue, useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { Spinner, UserAvatar } from "../../components/ui";
import { useAuth, useCurrentUser } from "../auth/AuthContext";
import { useWorldSession } from "../world/WorldSession";
import { useFriendRequests, useUserSearch } from "./hooks";
import { CityIcon, FriendsIcon, HomeIcon, LogoutIcon, SearchIcon, SettingsIcon } from "./Icons";
import styles from "./Social.module.css";

const navCls = ({ isActive }: { isActive: boolean }) => `${styles.navIcon} ${isActive ? styles.navActive : ""}`;
const tabCls = ({ isActive }: { isActive: boolean }) => `${styles.bottomLink} ${isActive ? styles.bottomActive : ""}`;

/**
 * Layout for the 2D social pages. The world session keeps running behind them.
 * With `left`/`right` it becomes a three-column layout (sidebars hide on narrow screens).
 */
export function AppShell({ children, wide, left, right }: { children: ReactNode; wide?: boolean; left?: ReactNode; right?: ReactNode }) {
  const me = useCurrentUser();
  const requests = useFriendRequests();
  const pending = requests.data?.incoming.length ?? 0;
  const columns = !!(left || right);

  const links = [
    { to: "/feed", label: "Feed", icon: <HomeIcon size={22} /> },
    { to: "/world", label: "City", icon: <CityIcon size={22} /> },
    { to: "/friends", label: "Friends", icon: <FriendsIcon size={22} />, badge: pending },
  ];

  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topLeft}>
          <Link to="/feed" className={styles.logo} aria-label="EntroWorld home">
            <span className={styles.logoMark}>E</span>
            <span className={styles.logoText}>EntroWorld</span>
          </Link>
          <GlobalSearch />
        </div>
        <nav className={styles.nav} aria-label="Main">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} className={navCls} title={l.label} aria-label={l.label}>
              {l.icon}
              {!!l.badge && <span className={styles.navBadge}>{l.badge > 9 ? "9+" : l.badge}</span>}
            </NavLink>
          ))}
        </nav>
        <div className={styles.topRight}>
          <Link to={`/u/${me.username}`} className={styles.meChip} title="Your profile">
            <UserAvatar name={me.displayName} url={me.avatarUrl} size={28} />
            <span className={styles.meName}>{me.displayName.split(" ")[0]}</span>
          </Link>
          <AccountMenu />
        </div>
      </header>

      {columns ? (
        <div className={styles.columns}>
          <aside className={styles.sideLeft}>{left}</aside>
          <main className={styles.center}>{children}</main>
          <aside className={styles.sideRight}>{right}</aside>
        </div>
      ) : (
        <main className={`${styles.content} ${wide ? styles.wide : ""}`}>{children}</main>
      )}

      <nav className={styles.bottomNav} aria-label="Main">
        {links.map((l) => (
          <NavLink key={l.to} to={l.to} className={tabCls}>
            <span className={styles.bottomIcon}>
              {l.icon}
              {!!l.badge && <span className={styles.navBadge}>{l.badge > 9 ? "9+" : l.badge}</span>}
            </span>
            {l.label}
          </NavLink>
        ))}
        <NavLink to={`/u/${me.username}`} className={tabCls}>
          <span className={styles.bottomIcon}>
            <UserAvatar name={me.displayName} url={me.avatarUrl} size={22} />
          </span>
          Profile
        </NavLink>
      </nav>
    </div>
  );
}

/** Closes a popover when clicking anywhere outside `ref`. */
export function useClickOutside(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, close]);
}

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const term = useDeferredValue(q);
  const search = useUserSearch(term);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useClickOutside(ref, open, () => setOpen(false));

  const go = (username: string) => {
    setOpen(false);
    setQ("");
    navigate(`/u/${username}`);
  };

  return (
    <div className={styles.search} ref={ref}>
      <SearchIcon size={17} className={styles.searchIcon} />
      <input
        className={styles.searchInput}
        placeholder="Search EntroWorld"
        value={q}
        aria-label="Search people"
        onFocus={() => setOpen(true)}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onKeyDown={(e) => {
          e.stopPropagation();
          const first = search.data?.[0];
          if (e.key === "Enter" && first) go(first.username);
        }}
      />
      {open && q.trim() && (
        <div className={styles.searchResults}>
          {search.isFetching && !search.data && <Spinner />}
          {search.data?.length === 0 && <span className={styles.searchEmpty}>No people found for “{q.trim()}”</span>}
          {search.data?.map((u) => (
            <button key={u.id} className={styles.searchItem} onClick={() => go(u.username)}>
              <UserAvatar name={u.displayName} url={u.avatarUrl} size={34} />
              <span className={styles.postMeta}>
                <span className={styles.name}>{u.displayName}</span>
                <span className={styles.muted}>@{u.username}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AccountMenu() {
  const me = useCurrentUser();
  const { logout } = useAuth();
  const { stop } = useWorldSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open, () => setOpen(false));

  const signOut = async () => {
    await stop();
    await logout();
    navigate("/", { replace: true });
  };

  return (
    <div className={styles.menu} ref={ref}>
      <button className={styles.circleBtn} aria-label="Account" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <SettingsIcon size={19} />
      </button>
      {open && (
        <div className={`${styles.menuList} ${styles.accountMenu}`}>
          <Link to={`/u/${me.username}`} className={styles.accountHead} onClick={() => setOpen(false)}>
            <UserAvatar name={me.displayName} url={me.avatarUrl} size={40} />
            <span className={styles.postMeta}>
              <span className={styles.name}>{me.displayName}</span>
              <span className={styles.muted}>See your profile</span>
            </span>
          </Link>
          <div className={styles.menuSep} />
          <Link to="/settings" className={styles.menuItem} onClick={() => setOpen(false)}>
            <SettingsIcon size={18} /> Settings & avatar
          </Link>
          <button className={styles.menuItem} onClick={() => void signOut()}>
            <LogoutIcon size={18} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export const fullDate = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
