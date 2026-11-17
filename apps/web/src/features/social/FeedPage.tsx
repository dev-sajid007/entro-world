import { useState } from "react";
import { AppShell } from "./AppShell";
import { useFeed, type FeedKind } from "./hooks";
import { Composer, PostList } from "./Posts";
import styles from "./Social.module.css";

const TABS: { id: FeedKind; label: string; empty: string }[] = [
  { id: "feed", label: "Following", empty: "Posts from you, your friends and people you follow show up here. Try Discover to find people." },
  { id: "discover", label: "Discover", empty: "Nobody has posted yet. Be the first!" },
  { id: "saved", label: "Saved", empty: "Posts you save appear here." },
];

export default function FeedPage() {
  const [tab, setTab] = useState<FeedKind>("feed");
  const query = useFeed(tab);
  const current = TABS.find((t) => t.id === tab)!;
  return (
    <AppShell>
      <h1 className={styles.pageTitle}>Feed</h1>
      <Composer />
      <div className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`${styles.tab} ${tab === t.id ? styles.tabActive : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <PostList query={query} empty={current.empty} />
    </AppShell>
  );
}
