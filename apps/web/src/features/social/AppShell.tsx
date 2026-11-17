import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { Button, UserAvatar } from "../../components/ui";
import { useAuth, useCurrentUser } from "../auth/AuthContext";
import { useWorldSession } from "../world/WorldSession";
import styles from "./Social.module.css";

const link = ({ isActive }: { isActive: boolean }) => `${styles.navLink} ${isActive ? styles.navActive : ""}`;

/** Layout for the 2D social pages. The world session keeps running behind them. */
export function AppShell({ children, wide }: { children: ReactNode; wide?: boolean }) {
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
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <Link to="/world" className={styles.logo}>
          EntroWorld
        </Link>
        <nav className={styles.nav}>
          <NavLink to="/world" className={link}>
            City
          </NavLink>
          <NavLink to="/feed" className={link}>
            Feed
          </NavLink>
          <NavLink to="/friends" className={link}>
            Friends
          </NavLink>
          <NavLink to="/settings" className={link}>
            Settings
          </NavLink>
        </nav>
        <Link to={`/u/${me.username}`} className={styles.me} title="Your profile">
          <UserAvatar name={me.displayName} url={me.avatarUrl} size={30} />
        </Link>
        <Button variant="ghost" size="small" onClick={() => void signOut()}>
          Sign out
        </Button>
      </header>
      <main className={`${styles.content} ${wide ? styles.wide : ""}`}>{children}</main>
    </div>
  );
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return new Date(iso).toLocaleDateString();
}
