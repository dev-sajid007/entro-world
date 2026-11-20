import type { ReactNode } from "react";
import { Link } from "react-router";
import { ZONES } from "@entroworld/shared";
import { UserAvatar } from "../../components/ui";
import { useCurrentUser } from "../auth/AuthContext";
import { useVoiceManager, useVoiceState } from "../voice/VoiceContext";
import { timeAgo } from "./AppShell";
import { useFriendRequests, useFriends, useSocialAction } from "./hooks";
import { PhoneIcon } from "./Icons";
import styles from "./Social.module.css";

export function SideItem({ icon, label, to, onClick, active }: { icon: ReactNode; label: string; to?: string; onClick?: () => void; active?: boolean }) {
  const cls = `${styles.sideItem} ${active ? styles.sideItemOn : ""}`;
  const inner = (
    <>
      <span className={styles.sideItemIcon}>{icon}</span>
      {label}
    </>
  );
  return to ? (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  ) : (
    <button className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}

/** "Your profile" row at the top of the left sidebar. */
export function MeItem() {
  const me = useCurrentUser();
  return (
    <Link to={`/u/${me.username}`} className={styles.sideItem}>
      <UserAvatar name={me.displayName} url={me.avatarUrl} size={32} />
      <span className={styles.postMeta}>
        <span className={styles.name}>{me.displayName}</span>
        <span className={styles.muted}>@{me.username}</span>
      </span>
    </Link>
  );
}

export function SideSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.sideSection}>
      <header className={styles.sideHead}>
        <h3>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Incoming friend requests with quick confirm/delete, like the "Friend requests" box on other networks. */
export function RequestsWidget() {
  const requests = useFriendRequests();
  const action = useSocialAction();
  const incoming = requests.data?.incoming ?? [];
  if (incoming.length === 0) return null;
  const act = (path: string) => action.mutate({ method: "POST", path }, { onSuccess: () => void requests.refetch() });
  return (
    <SideSection
      title="Friend requests"
      action={
        <Link to="/friends" className={styles.sideLink}>
          See all
        </Link>
      }
    >
      {incoming.slice(0, 3).map((r) => (
        <div key={r.id} className={styles.requestRow}>
          <Link to={`/u/${r.from.username}`}>
            <UserAvatar name={r.from.displayName} url={r.from.avatarUrl} size={44} />
          </Link>
          <div className={styles.requestBody}>
            <div className={styles.requestTop}>
              <Link to={`/u/${r.from.username}`} className={styles.name}>
                {r.from.displayName}
              </Link>
              <span className={styles.faint}>{timeAgo(r.createdAt)}</span>
            </div>
            <div className={styles.requestBtns}>
              <button className={styles.pillPrimary} disabled={action.isPending} onClick={() => act(`/friends/requests/${r.id}/accept`)}>
                Confirm
              </button>
              <button className={styles.pillSecondary} disabled={action.isPending} onClick={() => act(`/friends/requests/${r.id}/reject`)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      ))}
    </SideSection>
  );
}

/** Online friends first, with a green presence dot, like a "Contacts" list. */
export function ContactsWidget() {
  const friends = useFriends();
  const voice = useVoiceManager();
  const voiceState = useVoiceState(voice);
  const list = [...(friends.data ?? [])].sort((a, b) => Number(b.online) - Number(a.online));
  return (
    <SideSection title="Contacts">
      {friends.data?.length === 0 && (
        <p className={styles.faint}>
          No friends yet. <Link to="/friends">Find people</Link>
        </p>
      )}
      {list.slice(0, 14).map((f) => (
        <div key={f.id} className={styles.contact}>
          <Link to={`/u/${f.username}`} className={styles.contactLink}>
            <span className={styles.avatarWrap}>
              <UserAvatar name={f.displayName} url={f.avatarUrl} size={34} />
              {f.online && <span className={styles.presence} />}
            </span>
            <span className={styles.postMeta}>
              <span className={styles.name}>{f.displayName}</span>
              {f.online && <span className={styles.faint}>{f.zoneId ? `In ${ZONES[f.zoneId].name}` : "Online"}</span>}
            </span>
          </Link>
          {f.online && voice && voiceState.available && (
            <button
              className={styles.circleBtnSm}
              disabled={voiceState.call !== null}
              onClick={() => void voice.call(f)}
              aria-label={`Voice call ${f.displayName}`}
              title="Voice call"
            >
              <PhoneIcon size={15} />
            </button>
          )}
        </div>
      ))}
    </SideSection>
  );
}
