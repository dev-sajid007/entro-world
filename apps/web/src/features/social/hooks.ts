import type { AcademyAchievementsView } from "@entroworld/robot-api";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import type {
  AvatarConfig,
  CommentView,
  CurrentUser,
  FriendRequestView,
  FriendView,
  Paginated,
  PostView,
  PublicUser,
  SessionView,
  UserProfile,
  ZoneId,
} from "@entroworld/shared";
import type { CreatePostInput, UpdateMeInput } from "@entroworld/validation";
import { api } from "../../lib/api";

export type FeedKind = "feed" | "discover" | "saved";

export const keys = {
  posts: ["posts"] as const,
  feed: (kind: FeedKind) => ["posts", "list", kind] as const,
  userPosts: (userId: string) => ["posts", "list", "user", userId] as const,
  zonePosts: (zoneId: ZoneId) => ["posts", "list", "zone", zoneId] as const,
  comments: (postId: string) => ["comments", postId] as const,
  profile: (handle: string) => ["profile", handle.toLowerCase()] as const,
  profiles: ["profile"] as const,
  friends: ["friends"] as const,
  requests: ["friends", "requests"] as const,
  avatar: ["me", "avatar"] as const,
  sessions: ["me", "sessions"] as const,
  blocked: ["me", "blocked"] as const,
};

const qs = (cursor: string | null | undefined) => (cursor ? `?cursor=${encodeURIComponent(cursor)}` : "");

function usePostList(key: readonly unknown[], path: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: key,
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<Paginated<PostView>>(`${path}${qs(pageParam)}`),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export const useFeed = (kind: FeedKind) => usePostList(keys.feed(kind), `/posts/${kind}`);
export const useUserPosts = (userId: string | undefined) => usePostList(keys.userPosts(userId ?? ""), `/users/${userId}/posts`, !!userId);
export const useZonePosts = (zoneId: ZoneId) => usePostList(keys.zonePosts(zoneId), `/posts/zones/${zoneId}`);

/** Replaces a post wherever it appears in cached lists (after a reaction or edit). */
function patchPost(client: ReturnType<typeof useQueryClient>, post: PostView) {
  const { sharedPost: _, ...asShared } = post;
  const replace = (x: PostView): PostView => (x.id === post.id ? post : x.sharedPost?.id === post.id ? { ...x, sharedPost: asShared } : x);
  client.setQueriesData<InfiniteData<Paginated<PostView>>>({ queryKey: ["posts", "list"] }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map(replace) })) } : data,
  );
}

export function useCreatePost() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CreatePostInput>) => api.post<PostView>("/posts", input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.posts }),
  });
}

export function useReact() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ post, type, on }: { post: PostView; type: "like" | "save"; on: boolean }) =>
      on ? api.post<PostView>(`/posts/${post.id}/reactions`, { type }) : api.delete<PostView>(`/posts/${post.id}/reactions/${type}`),
    onSuccess: (post, vars) => {
      patchPost(client, post);
      if (vars.type === "save") void client.invalidateQueries({ queryKey: keys.feed("saved") });
    },
  });
}

export function useEditPost() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) => api.patch<PostView>(`/posts/${id}`, { content }),
    onSuccess: (post) => patchPost(client, post),
  });
}

export function useDeletePost() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/posts/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.posts }),
  });
}

export function useReport() {
  return useMutation({
    mutationFn: ({ path, reason, details }: { path: string; reason: string; details?: string }) => api.post(path, { reason, details: details ?? "" }),
  });
}

export function useComments(postId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: keys.comments(postId),
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<Paginated<CommentView>>(`/posts/${postId}/comments${qs(pageParam)}`),
    getNextPageParam: (last) => last.nextCursor,
  });
}

export function useAddComment(postId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => api.post<CommentView>(`/posts/${postId}/comments`, { content }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.comments(postId) });
      void client.invalidateQueries({ queryKey: keys.posts });
    },
  });
}

export function useDeleteComment(postId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => api.delete(`/posts/${postId}/comments/${commentId}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.comments(postId) });
      void client.invalidateQueries({ queryKey: keys.posts });
    },
  });
}

export const useProfile = (handle: string) => useQuery({ queryKey: keys.profile(handle), queryFn: () => api.get<UserProfile>(`/users/${encodeURIComponent(handle)}`) });

export const useFriends = () => useQuery({ queryKey: keys.friends, queryFn: () => api.get<FriendView[]>("/friends"), refetchInterval: 30_000 });
export const useUserFriends = (userId: string | undefined, enabled: boolean) =>
  useQuery({ queryKey: ["friends", "of", userId], enabled: enabled && !!userId, queryFn: () => api.get<FriendView[]>(`/users/${userId}/friends`) });
export const useUserAcademy = (userId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: ["academy", "achievements", userId],
    enabled: enabled && !!userId,
    queryFn: () => api.get<AcademyAchievementsView>(`/users/${userId}/academy`),
    staleTime: 60_000,
  });
export const useFriendRequests = () =>
  useQuery({ queryKey: keys.requests, queryFn: () => api.get<{ incoming: FriendRequestView[]; outgoing: FriendRequestView[] }>("/friends/requests") });

export function useUserSearch(q: string) {
  const term = q.trim();
  return useQuery({
    queryKey: ["users", "search", term.toLowerCase()],
    enabled: term.length >= 1,
    queryFn: () => api.get<PublicUser[]>(`/users/search?q=${encodeURIComponent(term)}`),
    staleTime: 10_000,
  });
}

/** Any action that changes a relationship refreshes profiles, friend lists and feeds. */
export function useSocialAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ method, path, body }: { method: "POST" | "DELETE"; path: string; body?: unknown }) =>
      method === "POST" ? api.post(path, body) : api.delete(path),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.profiles });
      void client.invalidateQueries({ queryKey: keys.friends });
      void client.invalidateQueries({ queryKey: keys.blocked });
      void client.invalidateQueries({ queryKey: keys.posts });
    },
  });
}

export function useUpdateMe() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMeInput) => api.patch<CurrentUser>("/users/me", input),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.profiles });
      void client.invalidateQueries({ queryKey: keys.posts });
    },
  });
}

export const useMyAvatar = () => useQuery({ queryKey: keys.avatar, queryFn: () => api.get<AvatarConfig>("/users/me/avatar"), staleTime: 60_000 });

export function useSaveAvatar() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (avatar: AvatarConfig) => api.put<AvatarConfig>("/users/me/avatar", avatar),
    onSuccess: (avatar) => {
      client.setQueryData(keys.avatar, avatar);
      void client.invalidateQueries({ queryKey: keys.profiles });
    },
  });
}

export const useSessions = () => useQuery({ queryKey: keys.sessions, queryFn: () => api.get<SessionView[]>("/auth/sessions") });
export const useBlocked = () => useQuery({ queryKey: keys.blocked, queryFn: () => api.get<PublicUser[]>("/users/me/blocked") });
