import { useState } from "react";
import { AppShell } from "./AppShell";
import { useFeed, type FeedKind } from "./hooks";
import { BookmarkIcon, CityIcon, FriendsIcon, GlobeIcon, HomeIcon, SettingsIcon } from "./Icons";
import { Composer, PostList } from "./Posts";
import { ContactsWidget, MeItem, RequestsWidget, SideItem } from "./Sidebar";
import styles from "./Social.module.css";

const TABS: { id: FeedKind; label: string; empty: string }[] = [
  { id: "feed", label: "For you", empty: "Posts from you, your friends and people you follow show up here. Try Discover to find people." },
  { id: "discover", label: "Discover", empty: "Nobody has posted yet. Be the first!" },
  { id: "saved", label: "Saved", empty: "Posts you save appear here." },
];

export default function FeedPage() {
  const [tab, setTab] = useState<FeedKind>("feed");
  const query = useFeed(tab);
  const current = TABS.find((t) => t.id === tab)!;
  const pick = (t: FeedKind) => {
    setTab(t);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const left = (
    <nav className={styles.sideNav} aria-label="Shortcuts">
      <MeItem />
      <SideItem icon={<HomeIcon />} label="Home feed" active={tab === "feed"} onClick={() => pick("feed")} />
      <SideItem icon={<GlobeIcon />} label="Discover" active={tab === "discover"} onClick={() => pick("discover")} />
      <SideItem icon={<BookmarkIcon />} label="Saved posts" active={tab === "saved"} onClick={() => pick("saved")} />
      <SideItem icon={<FriendsIcon />} label="Friends" to="/friends" />
      <SideItem icon={<CityIcon />} label="Enter the City" to="/world" />
      <SideItem icon={<SettingsIcon />} label="Settings" to="/settings" />
      <p className={styles.sideFoot}>EntroWorld · a living city of friends</p>
    </nav>
  );

  const right = (
    <>
      <RequestsWidget />
      <ContactsWidget />
    </>
  );

  return (
    <AppShell left={left} right={right}>
      <Composer />
      <div className={styles.feedTabs} role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`${styles.feedTab} ${tab === t.id ? styles.feedTabOn : ""}`} onClick={() => pick(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <PostList query={query} empty={current.empty} />
    </AppShell>
  );
}
