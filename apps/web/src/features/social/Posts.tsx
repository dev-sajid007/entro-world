import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { LIMITS, ZONES, type CommentView, type PostView, type PostVisibility, type WorldLocation } from "@entroworld/shared";
import { REPORT_REASONS } from "@entroworld/validation";
import { Button, Card, Empty, ErrorText, Spinner, Textarea, UserAvatar } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { useCurrentUser } from "../auth/AuthContext";
import { timeAgo } from "./AppShell";
import { useAddComment, useComments, useCreatePost, useDeleteComment, useDeletePost, useEditPost, useReact, useReport } from "./hooks";
import styles from "./Social.module.css";

const VISIBILITY_LABEL: Record<PostVisibility, string> = { public: "Public", friends: "Friends", private: "Only me" };

export function Composer({ location, placeholder, onPosted }: { location?: WorldLocation; placeholder?: string; onPosted?: () => void }) {
  const me = useCurrentUser();
  const create = useCreatePost();
  const [content, setContent] = useState("");
  const [visibility, setVisibility] = useState<PostVisibility>("public");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;
    await create.mutateAsync({ content, visibility, ...(location ? { location } : {}) });
    setContent("");
    onPosted?.();
  };

  return (
    <Card>
      <form className={styles.composer} onSubmit={(e) => void submit(e).catch(() => undefined)}>
        <div className={styles.row}>
          <UserAvatar name={me.displayName} url={me.avatarUrl} />
          <span className={styles.muted}>{location ? `Pinning to ${ZONES[location.zoneId].name}` : "Share something with the city"}</span>
        </div>
        <Textarea
          value={content}
          maxLength={LIMITS.postContent.max}
          rows={3}
          placeholder={placeholder ?? "What's happening?"}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <div className={styles.row}>
          <select className={styles.select} value={visibility} onChange={(e) => setVisibility(e.target.value as PostVisibility)} aria-label="Who can see this">
            {(Object.keys(VISIBILITY_LABEL) as PostVisibility[]).map((v) => (
              <option key={v} value={v}>
                {VISIBILITY_LABEL[v]}
              </option>
            ))}
          </select>
          <span className={styles.spacer} />
          {create.error && <ErrorText>{errorMessage(create.error)}</ErrorText>}
          <Button type="submit" disabled={create.isPending || !content.trim()}>
            {create.isPending ? "Posting…" : "Post"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Author({ post, extra }: { post: Omit<PostView, "sharedPost">; extra?: ReactNode }) {
  return (
    <div className={styles.postHead}>
      <Link to={`/u/${post.author.username}`}>
        <UserAvatar name={post.author.displayName} url={post.author.avatarUrl} />
      </Link>
      <div className={styles.postMeta}>
        <Link to={`/u/${post.author.username}`} className={styles.name}>
          {post.author.displayName}
        </Link>
        <span className={styles.muted}>
          @{post.author.username} · {timeAgo(post.createdAt)}
          {post.visibility !== "public" && ` · ${VISIBILITY_LABEL[post.visibility]}`}
        </span>
      </div>
      {extra}
    </div>
  );
}

function LocationTag({ location }: { location: WorldLocation }) {
  return <span className={styles.location}>📍 {ZONES[location.zoneId]?.name ?? location.zoneId}</span>;
}

export function PostCard({ post }: { post: PostView }) {
  const me = useCurrentUser();
  const react = useReact();
  const share = useCreatePost();
  const [showComments, setShowComments] = useState(false);
  const [editing, setEditing] = useState(false);
  const mine = post.author.id === me.id;
  const original = post.postType === "share" ? post.sharedPost : null;
  const shareTarget = original ?? post;

  return (
    <Card className={styles.post}>
      <Author post={post} extra={<PostMenu post={post} mine={mine} onEdit={() => setEditing(true)} />} />
      {editing ? (
        <EditPost post={post} onDone={() => setEditing(false)} />
      ) : (
        post.content && <p className={styles.body}>{post.content}</p>
      )}
      {post.location && <LocationTag location={post.location} />}
      {post.postType === "share" &&
        (original ? (
          <div className={styles.shared}>
            <Author post={original} />
            {original.content && <p className={styles.body}>{original.content}</p>}
            {original.location && <LocationTag location={original.location} />}
          </div>
        ) : (
          <div className={styles.shared}>
            <span className={styles.muted}>This post is no longer available.</span>
          </div>
        ))}
      <div className={styles.actions}>
        <button className={`${styles.action} ${post.viewer.liked ? styles.actionOn : ""}`} onClick={() => react.mutate({ post, type: "like", on: !post.viewer.liked })}>
          {post.viewer.liked ? "♥" : "♡"} {post.counts.likes || ""} Like
        </button>
        <button className={styles.action} onClick={() => setShowComments((v) => !v)}>
          💬 {post.counts.comments || ""} Comment
        </button>
        {shareTarget.visibility !== "private" && (
          <button
            className={styles.action}
            disabled={share.isPending || share.isSuccess}
            onClick={() => share.mutate({ content: "", sharedPostId: shareTarget.id })}
            title="Share to your feed"
          >
            ↻ {post.counts.shares || ""} {share.isSuccess ? "Shared" : "Share"}
          </button>
        )}
        <button className={`${styles.action} ${post.viewer.saved ? styles.actionOn : ""}`} onClick={() => react.mutate({ post, type: "save", on: !post.viewer.saved })}>
          {post.viewer.saved ? "★ Saved" : "☆ Save"}
        </button>
      </div>
      {share.error && <ErrorText>{errorMessage(share.error)}</ErrorText>}
      {showComments && <Comments post={post} />}
    </Card>
  );
}

function EditPost({ post, onDone }: { post: PostView; onDone: () => void }) {
  const edit = useEditPost();
  const [content, setContent] = useState(post.content);
  return (
    <div className={styles.composer}>
      <Textarea value={content} rows={3} maxLength={LIMITS.postContent.max} onChange={(e) => setContent(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
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
  return (
    <div className={styles.menu}>
      <button className={styles.action} aria-label="Post options" onClick={() => setOpen(open ? null : "menu")}>
        ⋯
      </button>
      {open && (
        <div className={styles.menuList}>
          {open === "menu" && (
            <>
              {mine && (
                <button className={styles.menuItem} onClick={() => (setOpen(null), onEdit())}>
                  Edit
                </button>
              )}
              {mine && (
                <button className={`${styles.menuItem} ${styles.menuDanger}`} onClick={() => setOpen("delete")}>
                  Delete
                </button>
              )}
              {!mine && (
                <button className={styles.menuItem} onClick={() => setOpen("report")}>
                  Report
                </button>
              )}
            </>
          )}
          {open === "delete" && (
            <>
              <span className={styles.muted} style={{ padding: "6px 10px" }}>
                Delete this post?
              </span>
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
      <div style={{ padding: "6px 10px" }}>
        <p className={styles.muted}>Thanks — our moderators will take a look.</p>
        <Button size="small" variant="ghost" onClick={onDone}>
          Close
        </Button>
      </div>
    );
  return (
    <>
      <span className={styles.muted} style={{ padding: "6px 10px" }}>
        Why are you reporting this?
      </span>
      {REPORT_REASONS.map((reason) => (
        <button key={reason} className={styles.menuItem} disabled={report.isPending} onClick={() => report.mutate({ path, reason })}>
          {reason.replace("_", " ").replace(/^./, (c) => c.toUpperCase())}
        </button>
      ))}
      {report.error && <ErrorText>{errorMessage(report.error)}</ErrorText>}
    </>
  );
}

function Comments({ post }: { post: PostView }) {
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
            <UserAvatar name={c.author.displayName} url={c.author.avatarUrl} size={28} />
          </Link>
          <div className={styles.commentBody}>
            <span className={styles.name}>{c.author.displayName}</span> <span className={styles.muted}>{timeAgo(c.createdAt)}</span>
            <p>{c.content}</p>
          </div>
          {(c.author.id === me.id || post.author.id === me.id) && (
            <button className={styles.action} aria-label="Delete comment" onClick={() => remove.mutate(c.id)}>
              ✕
            </button>
          )}
        </div>
      ))}
      {list.hasNextPage && (
        <Button variant="ghost" size="small" onClick={() => void list.fetchNextPage()}>
          More comments
        </Button>
      )}
      <form className={styles.row} onSubmit={submit}>
        <input
          className={styles.select}
          style={{ flex: 1 }}
          value={text}
          maxLength={LIMITS.commentContent.max}
          placeholder="Write a comment…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
        />
        <Button type="submit" size="small" disabled={add.isPending || !text.trim()}>
          Reply
        </Button>
      </form>
      {add.error && <ErrorText>{errorMessage(add.error)}</ErrorText>}
    </div>
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
  if (query.isLoading) return <Spinner />;
  if (query.error) return <ErrorText>{errorMessage(query.error)}</ErrorText>;
  if (posts.length === 0) return <Empty>{empty}</Empty>;
  return (
    <>
      {posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      {query.hasNextPage && (
        <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
          {query.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      )}
    </>
  );
}
