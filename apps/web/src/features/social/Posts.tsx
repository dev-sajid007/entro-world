import { useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { Link } from "react-router";
import { LIMITS, ZONES, type CommentView, type PostView, type PostVisibility, type WorldLocation } from "@entroworld/shared";
import { REPORT_REASONS } from "@entroworld/validation";
import { Button, Card, Empty, ErrorText, Spinner, Textarea, UserAvatar } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { useCurrentUser } from "../auth/AuthContext";
import { fullDate, timeAgo, useClickOutside } from "./AppShell";
import { useAddComment, useComments, useCreatePost, useDeleteComment, useDeletePost, useEditPost, useReact, useReport } from "./hooks";
import { BookmarkIcon, CommentIcon, FriendsIcon, GlobeIcon, HeartIcon, LockIcon, MoreIcon, PinIcon, SendIcon, ShareIcon } from "./Icons";
import styles from "./Social.module.css";

const VISIBILITY: Record<PostVisibility, { label: string; icon: ReactNode }> = {
  public: { label: "Public", icon: <GlobeIcon size={14} /> },
  friends: { label: "Friends", icon: <FriendsIcon size={14} /> },
  private: { label: "Only me", icon: <LockIcon size={14} /> },
};

export function Composer({ location, placeholder, onPosted }: { location?: WorldLocation; placeholder?: string; onPosted?: () => void }) {
  const me = useCurrentUser();
  const create = useCreatePost();
  const [open, setOpen] = useState(!!location);
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("public");
  const first = me.displayName.split(" ")[0];
  const left = LIMITS.postContent.max - content.length;

  const submit = async (e: { preventDefault(): void }) => {
    e.preventDefault();
    if (!content.trim() || create.isPending) return;
    await create.mutateAsync({ content, visibility, ...(location ? { location } : {}) });
    setContent("");
    if (!location) setOpen(false);
    onPosted?.();
  };

  return (
    <Card className={styles.composerCard}>
      {!open ? (
        <div className={styles.composerCollapsed}>
          <Link to={`/u/${me.username}`}>
            <UserAvatar name={me.displayName} url={me.avatarUrl} size={40} />
          </Link>
          <button className={styles.composerPrompt} onClick={() => setOpen(true)}>
            {placeholder ?? `What's on your mind, ${first}?`}
          </button>
        </div>
      ) : (
        <form className={styles.composer} onSubmit={(e) => void submit(e).catch(() => undefined)}>
          <div className={styles.postHead}>
            <UserAvatar name={me.displayName} url={me.avatarUrl} size={40} />
            <div className={styles.postMeta}>
              <span className={styles.name}>{me.displayName}</span>
              {location ? (
                <span className={styles.location}>
                  <PinIcon size={13} /> Pinning to {ZONES[location.zoneId].name}
                </span>
              ) : (
                <div className={styles.visPicker} role="radiogroup" aria-label="Who can see this">
                  {(Object.keys(VISIBILITY) as PostVisibility[]).map((v) => (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={visibility === v}
                      className={`${styles.visChip} ${visibility === v ? styles.visChipOn : ""}`}
                      onClick={() => setVisibility(v)}
                    >
                      {VISIBILITY[v].icon} {VISIBILITY[v].label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Textarea
            className={styles.composerInput}
            value={content}
            autoFocus={!location}
            maxLength={LIMITS.postContent.max}
            rows={content.length > 120 ? 5 : 3}
            placeholder={placeholder ?? `What's on your mind, ${first}?`}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit(e).catch(() => undefined);
            }}
          />
          <div className={styles.row}>
            {left < 100 && <span className={`${styles.faint} ${left < 20 ? styles.warn : ""}`}>{left}</span>}
            <span className={styles.spacer} />
            {create.error && <ErrorText>{errorMessage(create.error)}</ErrorText>}
            {!location && (
              <Button variant="ghost" size="small" onClick={() => (setOpen(false), setContent(""))}>
                Cancel
              </Button>
            )}
            <Button type="submit" disabled={create.isPending || !content.trim()}>
              {create.isPending ? "Posting…" : "Post"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function Author({ post, extra, size = 42 }: { post: Omit<PostView, "sharedPost">; extra?: ReactNode; size?: number }) {
  const vis = VISIBILITY[post.visibility];
  return (
    <div className={styles.postHead}>
      <Link to={`/u/${post.author.username}`}>
        <UserAvatar name={post.author.displayName} url={post.author.avatarUrl} size={size} />
      </Link>
      <div className={styles.postMeta}>
        <Link to={`/u/${post.author.username}`} className={styles.name}>
          {post.author.displayName}
        </Link>
        <span className={styles.metaLine}>
          <span title={fullDate(post.createdAt)}>{timeAgo(post.createdAt)}</span>
          {post.updatedAt !== post.createdAt && <span title={`Edited ${fullDate(post.updatedAt)}`}>· Edited</span>}
          <span>·</span>
          <span className={styles.metaIcon} title={vis.label} aria-label={vis.label}>
            {vis.icon}
          </span>
        </span>
      </div>
      {extra}
    </div>
  );
}

function LocationTag({ location }: { location: WorldLocation }) {
  return (
    <span className={styles.location}>
      <PinIcon size={13} /> {ZONES[location.zoneId]?.name ?? location.zoneId}
    </span>
  );
}

/** Short text-only posts render bigger, like status updates on other networks. */
const Body = ({ text, big }: { text: string; big?: boolean }) => <p className={`${styles.body} ${big && text.length <= 90 ? styles.bodyBig : ""}`}>{text}</p>;

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function PostCard({ post }: { post: PostView }) {
  const me = useCurrentUser();
  const react = useReact();
  const share = useCreatePost();
  const [showComments, setShowComments] = useState(false);
  const [editing, setEditing] = useState(false);
  const [burst, setBurst] = useState(0);
  const commentInput = useRef<HTMLInputElement>(null);
  const mine = post.author.id === me.id;
  const original = post.postType === "share" ? post.sharedPost : null;
  const shareTarget = original ?? post;
  const { likes, comments, shares } = post.counts;

  const like = (on = !post.viewer.liked) => {
    if (on) setBurst((b) => b + 1);
    if (on !== post.viewer.liked) react.mutate({ post, type: "like", on });
  };
  const openComments = () => {
    setShowComments(true);
    requestAnimationFrame(() => commentInput.current?.focus());
  };

  return (
    <Card className={styles.post}>
      {post.postType === "share" && (
        <span className={styles.shareNote}>
          <ShareIcon size={14} /> {mine ? "You" : post.author.displayName} shared a post
        </span>
      )}
      <Author post={post} extra={<PostMenu post={post} mine={mine} onEdit={() => setEditing(true)} />} />
      <div className={styles.postContent} onDoubleClick={() => !editing && like(true)}>
        {editing ? <EditPost post={post} onDone={() => setEditing(false)} /> : post.content && <Body text={post.content} big={!original} />}
        {post.location && <LocationTag location={post.location} />}
        {post.postType === "share" &&
          (original ? (
            <div className={styles.shared}>
              <Author post={original} size={34} />
              {original.content && <Body text={original.content} />}
              {original.location && <LocationTag location={original.location} />}
            </div>
          ) : (
            <div className={styles.shared}>
              <span className={styles.muted}>This post is no longer available.</span>
            </div>
          ))}
        {burst > 0 && (
          <span key={burst} className={styles.heartBurst} aria-hidden>
            <HeartIcon size={72} filled />
          </span>
        )}
      </div>

      {(likes > 0 || comments > 0 || shares > 0) && (
        <div className={styles.counts}>
          {likes > 0 && (
            <span className={styles.likeCount}>
              <span className={styles.likeBubble}>
                <HeartIcon size={11} filled />
              </span>
              {post.viewer.liked ? (likes === 1 ? "You" : `You and ${plural(likes - 1, "other")}`) : likes}
            </span>
          )}
          <span className={styles.spacer} />
          {comments > 0 && (
            <button className={styles.countLink} onClick={() => setShowComments((v) => !v)}>
              {plural(comments, "comment")}
            </button>
          )}
          {shares > 0 && <span>{plural(shares, "share")}</span>}
        </div>
      )}

      <div className={styles.actions}>
        <button className={`${styles.action} ${post.viewer.liked ? styles.actionLiked : ""}`} aria-pressed={post.viewer.liked} onClick={() => like()}>
          <HeartIcon size={19} filled={post.viewer.liked} className={post.viewer.liked ? styles.pop : ""} /> Like
        </button>
        <button className={styles.action} onClick={openComments}>
          <CommentIcon size={19} /> Comment
        </button>
        {shareTarget.visibility !== "private" && (
          <button
            className={`${styles.action} ${share.isSuccess ? styles.actionOn : ""}`}
            disabled={share.isPending || share.isSuccess}
            onClick={() => share.mutate({ content: "", sharedPostId: shareTarget.id })}
            title="Share to your feed"
          >
            <ShareIcon size={19} /> {share.isSuccess ? "Shared" : "Share"}
          </button>
        )}
        <button
          className={`${styles.action} ${post.viewer.saved ? styles.actionOn : ""}`}
          aria-pressed={post.viewer.saved}
          onClick={() => react.mutate({ post, type: "save", on: !post.viewer.saved })}
        >
          <BookmarkIcon size={19} filled={post.viewer.saved} /> {post.viewer.saved ? "Saved" : "Save"}
        </button>
      </div>
      {share.error && <ErrorText>{errorMessage(share.error)}</ErrorText>}
      {showComments && <Comments post={post} inputRef={commentInput} />}
    </Card>
  );
}

function EditPost({ post, onDone }: { post: PostView; onDone: () => void }) {
  const edit = useEditPost();
  const [content, setContent] = useState(post.content);
  return (
    <div className={styles.composer}>
      <Textarea value={content} rows={3} autoFocus maxLength={LIMITS.postContent.max} onChange={(e) => setContent(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <div className={styles.row}>
        <span className={styles.spacer} />
        {edit.error && <ErrorText>{errorMessage(edit.error)}</ErrorText>}
        <Button variant="ghost" size="small" onClick={onDone}>
          Cancel
        </Button>
        <Button size="small" disabled={edit.isPending} onClick={() => edit.mutate({ id: post.id, content }, { onSuccess: onDone })}>
          Save
        </Button>
      </div>
    </div>
  );
}

function PostMenu({ post, mine, onEdit }: { post: PostView; mine: boolean; onEdit: () => void }) {
  const [open, setOpen] = useState<"menu" | "delete" | "report" | null>(null);
  const del = useDeletePost();
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, open !== null, () => setOpen(null));
  return (
    <div className={styles.menu} ref={ref}>
      <button className={styles.circleBtnSm} aria-label="Post options" onClick={() => setOpen(open ? null : "menu")}>
        <MoreIcon size={18} />
      </button>
      {open && (
        <div className={styles.menuList}>
          {open === "menu" && (
            <>
              {mine && (
                <button className={styles.menuItem} onClick={() => (setOpen(null), onEdit())}>
                  Edit post
                </button>
              )}
              {mine && (
                <button className={`${styles.menuItem} ${styles.menuDanger}`} onClick={() => setOpen("delete")}>
                  Delete post
                </button>
              )}
              {!mine && (
                <button className={styles.menuItem} onClick={() => setOpen("report")}>
                  Report post
                </button>
              )}
            </>
          )}
          {open === "delete" && (
            <>
              <span className={styles.menuNote}>Delete this post? This can't be undone.</span>
              <button className={`${styles.menuItem} ${styles.menuDanger}`} disabled={del.isPending} onClick={() => del.mutate(post.id)}>
                Yes, delete
              </button>
              <button className={styles.menuItem} onClick={() => setOpen(null)}>
                Cancel
              </button>
            </>
          )}
          {open === "report" && <ReportForm path={`/posts/${post.id}/report`} onDone={() => setOpen(null)} />}
        </div>
      )}
    </div>
  );
}

export function ReportForm({ path, onDone }: { path: string; onDone: () => void }) {
  const report = useReport();
  if (report.isSuccess)
    return (
      <div className={styles.menuNote}>
        <p className={styles.muted}>Thanks — our moderators will take a look.</p>
        <Button size="small" variant="ghost" onClick={onDone}>
          Close
        </Button>
      </div>
    );
  return (
    <>
      <span className={styles.menuNote}>Why are you reporting this?</span>
      {REPORT_REASONS.map((reason) => (
        <button key={reason} className={styles.menuItem} disabled={report.isPending} onClick={() => report.mutate({ path, reason })}>
          {reason.replace("_", " ").replace(/^./, (c) => c.toUpperCase())}
        </button>
      ))}
      {report.error && <ErrorText>{errorMessage(report.error)}</ErrorText>}
    </>
  );
}

function Comments({ post, inputRef }: { post: PostView; inputRef: RefObject<HTMLInputElement | null> }) {
  const me = useCurrentUser();
  const list = useComments(post.id, true);
  const add = useAddComment(post.id);
  const remove = useDeleteComment(post.id);
  const [text, setText] = useState("");
  const items: CommentView[] = list.data?.pages.flatMap((p) => p.items) ?? [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    add.mutate(text, { onSuccess: () => setText("") });
  };

  return (
    <div className={styles.comments}>
      {list.isLoading && <Spinner />}
      {items.map((c) => (
        <div key={c.id} className={styles.comment}>
          <Link to={`/u/${c.author.username}`}>
            <UserAvatar name={c.author.displayName} url={c.author.avatarUrl} size={32} />
          </Link>
          <div className={styles.commentMain}>
            <div className={styles.commentBody}>
              <Link to={`/u/${c.author.username}`} className={styles.name}>
                {c.author.displayName}
              </Link>
              <p>{c.content}</p>
            </div>
            <div className={styles.commentMeta}>
              <span title={fullDate(c.createdAt)}>{timeAgo(c.createdAt)}</span>
              {(c.author.id === me.id || post.author.id === me.id) && (
                <button className={styles.textBtn} disabled={remove.isPending} onClick={() => remove.mutate(c.id)}>
                  Delete
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {list.hasNextPage && (
        <button className={styles.textBtn} onClick={() => void list.fetchNextPage()}>
          View more comments
        </button>
      )}
      <form className={styles.commentForm} onSubmit={submit}>
        <UserAvatar name={me.displayName} url={me.avatarUrl} size={32} />
        <div className={styles.commentInputWrap}>
          <input
            ref={inputRef}
            className={styles.commentInput}
            value={text}
            maxLength={LIMITS.commentContent.max}
            placeholder={`Comment as ${me.displayName}…`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          <button type="submit" className={styles.sendBtn} disabled={add.isPending || !text.trim()} aria-label="Send comment">
            <SendIcon size={17} />
          </button>
        </div>
      </form>
      {add.error && <ErrorText>{errorMessage(add.error)}</ErrorText>}
    </div>
  );
}

function PostSkeleton() {
  return (
    <Card className={styles.post}>
      <div className={styles.postHead}>
        <span className={`${styles.skel} ${styles.skelCircle}`} />
        <div className={styles.postMeta} style={{ gap: 6 }}>
          <span className={styles.skel} style={{ width: "35%", height: 12 }} />
          <span className={styles.skel} style={{ width: "20%", height: 10 }} />
        </div>
      </div>
      <span className={styles.skel} style={{ width: "92%", height: 12 }} />
      <span className={styles.skel} style={{ width: "70%", height: 12 }} />
    </Card>
  );
}

/** A paginated list of posts from an infinite query. */
export function PostList({
  query,
  empty,
}: {
  query: { data?: { pages: { items: PostView[] }[] }; isLoading: boolean; error: unknown; hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage: () => unknown };
  empty: ReactNode;
}) {
  const posts = query.data?.pages.flatMap((p) => p.items) ?? [];
  if (query.isLoading)
    return (
      <>
        <PostSkeleton />
        <PostSkeleton />
      </>
    );
  if (query.error) return <ErrorText>{errorMessage(query.error)}</ErrorText>;
  if (posts.length === 0)
    return (
      <Card>
        <Empty>{empty}</Empty>
      </Card>
    );
  return (
    <>
      {posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      {query.hasNextPage ? (
        <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      ) : (
        posts.length > 3 && <p className={styles.endNote}>You're all caught up ✨</p>
      )}
    </>
  );
}
