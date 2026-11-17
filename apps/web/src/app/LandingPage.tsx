import { Link } from "react-router";
import { useAuth } from "../features/auth/AuthContext";
import styles from "./LandingPage.module.css";

export default function LandingPage() {
  const { status, user } = useAuth();
  const signedIn = status === "authenticated" && user;
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <span className={styles.logo}>EntroWorld</span>
        <nav className={styles.nav}>
          {signedIn ? (
            <>
              <Link to="/feed">Feed</Link>
              <Link to="/world" className={styles.cta}>
                Enter the city
              </Link>
            </>
          ) : (
            <>
              <Link to="/login">Sign in</Link>
              <Link to="/register" className={styles.cta}>
                Create account
              </Link>
            </>
          )}
        </nav>
      </header>
      <main className={styles.hero}>
        <h1>
          A social network you can <span>walk around in</span>.
        </h1>
        <p>
          Meet people in a living 3D city. Chat face to face, hang out in the plaza, attend live events, share posts and build a home
          of your own — right in your browser.
        </p>
        <div className={styles.actions}>
          {signedIn ? (
            <Link to="/world" className={styles.cta}>
              Welcome back, {user.displayName} — enter the city
            </Link>
          ) : (
            <Link to="/register" className={styles.cta}>
              Join the city
            </Link>
          )}
          <Link to="/sandbox" className={styles.secondary}>
            Explore the sandbox
          </Link>
          {import.meta.env.DEV && (
            <Link to="/dev/multiplayer" className={styles.secondary}>
              Multiplayer test (dev)
            </Link>
          )}
        </div>
      </main>
    </div>
  );
}
