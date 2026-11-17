import type { AvatarConfig } from "./avatar-types";
import type { ZoneId } from "./zones";

export type UserRole = "user" | "moderator" | "admin";
export type UserStatus = "active" | "suspended" | "banned";
export type PrivacySetting = "public" | "friends" | "private";
export type PostVisibility = "public" | "friends" | "private";
export type PostType = "text" | "image" | "video" | "location" | "event" | "share";
export type ReactionType = "like" | "save";
export type FriendshipStatus = "none" | "pending_outgoing" | "pending_incoming" | "friends" | "blocked" | "blocked_by";
export type MediaType = "image" | "video";
export type ConversationType = "direct" | "group";
export type NotificationType =
  | "friend_request"
  | "friend_accept"
  | "message"
  | "like"
  | "comment"
  | "mention"
  | "event_invite"
  | "friend_online"
  | "share";
export type EventRsvpStatus = "going" | "interested";

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface CurrentUser extends PublicUser {
  email: string;
  emailVerified: boolean;
  role: UserRole;
  status: UserStatus;
  createdAt: string;
}

/** Returned by register (when no verification is required), login and refresh. */
export interface AuthTokenResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  user: CurrentUser;
}

export interface RegisterResponse {
  /** Present when the account may sign in immediately. */
  session: AuthTokenResponse | null;
  verificationRequired: boolean;
}

/** One signed-in device (a refresh-token family). */
export interface SessionView {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}

export interface WorldLocation {
  zoneId: ZoneId;
  x: number;
  y: number;
  z: number;
}

export interface UserProfile {
  user: PublicUser;
  bio: string;
  coverUrl: string | null;
  privacy: PrivacySetting;
  avatar: AvatarConfig;
  createdAt: string;
  stats: { friends: number; followers: number; following: number; posts: number };
  relationship: {
    isSelf: boolean;
    friendship: FriendshipStatus;
    friendRequestId: string | null;
    following: boolean;
    followsYou: boolean;
  };
  online: boolean;
  location: { zoneId: ZoneId } | null;
  /** True when the profile is private to the viewer and details were redacted. */
  restricted: boolean;
}

export interface MediaItem {
  id: string;
  url: string;
  mediaType: MediaType;
  width: number | null;
  height: number | null;
}

export interface PostView {
  id: string;
  author: PublicUser;
  content: string;
  postType: PostType;
  visibility: PostVisibility;
  media: MediaItem[];
  location: WorldLocation | null;
  event: EventSummary | null;
  sharedPost: Omit<PostView, "sharedPost"> | null;
  createdAt: string;
  updatedAt: string;
  counts: { likes: number; comments: number; shares: number };
  viewer: { liked: boolean; saved: boolean };
}

export interface CommentView {
  id: string;
  postId: string;
  author: PublicUser;
  content: string;
  createdAt: string;
}

export interface FriendRequestView {
  id: string;
  from: PublicUser;
  to: PublicUser;
  createdAt: string;
}

export interface FriendView extends PublicUser {
  online: boolean;
  zoneId: ZoneId | null;
  since: string;
}

export interface ConversationView {
  id: string;
  type: ConversationType;
  title: string | null;
  members: PublicUser[];
  lastMessage: MessageView | null;
  unreadCount: number;
  updatedAt: string;
}

export interface MessageView {
  id: string;
  conversationId: string;
  sender: PublicUser;
  content: string;
  messageType: "text" | "system";
  createdAt: string;
  editedAt: string | null;
}

export interface ReadReceipt {
  conversationId: string;
  userId: string;
  lastReadMessageId: string;
  readAt: string;
}

export interface NotificationView {
  id: string;
  type: NotificationType;
  actor: PublicUser | null;
  referenceId: string | null;
  text: string;
  isRead: boolean;
  createdAt: string;
}

export interface EventSummary {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  zoneId: ZoneId;
}

export interface EventView extends EventSummary {
  description: string;
  host: PublicUser;
  location: WorldLocation;
  visibility: "public" | "friends";
  attendeeCount: number;
  viewerRsvp: EventRsvpStatus | null;
  status: "upcoming" | "live" | "ended";
  createdAt: string;
}

export interface ZoneView {
  id: ZoneId;
  name: string;
  description: string;
  worldId: string;
  isActive: boolean;
  onlinePlayers: number;
}

export interface WorldView {
  id: string;
  name: string;
  slug: string;
  zones: ZoneView[];
}

export interface WorldJoinResponse {
  ticket: string;
  zoneId: ZoneId;
  gameServerUrl: string;
  spawn: { x: number; y: number; z: number; rotation: number };
  expiresAt: string;
}

export interface WorldInstanceView {
  id: string;
  zoneId: ZoneId;
  roomId: string;
  serverId: string;
  status: string;
  currentPlayers: number;
  createdAt: string;
}

export interface InventoryItemView {
  itemId: string;
  name: string;
  category: string;
  quantity: number;
  placed: number;
}

export interface FurniturePlacement {
  id: string;
  itemId: string;
  /** Local coordinates relative to the plot origin (meters). */
  x: number;
  z: number;
  rotation: number;
  color?: string | undefined;
}

export interface PropertyConfiguration {
  wallColor: string;
  roofColor: string;
  floorStyle: "wood" | "tile" | "carpet";
  furniture: FurniturePlacement[];
  visibility: "public" | "friends" | "private";
}

export interface PropertyView {
  id: string;
  plotId: string;
  zoneId: ZoneId;
  owner: PublicUser;
  propertyType: string;
  name: string;
  configuration: PropertyConfiguration;
  createdAt: string;
}

export interface PlotView {
  plotId: string;
  property: PropertyView | null;
}

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
