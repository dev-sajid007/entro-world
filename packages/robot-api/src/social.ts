import { z } from "zod";
import { MAX_ACTION_LOG, MAX_DRAFT_CODE_LENGTH, robotActionSchema } from "./actions";

/**
 * Social learning (SPEC-ADDENDUM-01 Milestone A3): weekly leaderboards, pair programming and
 * coding battles. Pair and battle sessions run in their own game-server room (`ACADEMY_ROOM`),
 * separate from the zone tick loop; the API creates them and hands out room tickets.
 */

// -------------------------------------------------------------------------------------------------
// Leaderboards
// -------------------------------------------------------------------------------------------------

export const LEADERBOARD_SCOPES = ["friends", "global"] as const;
export type LeaderboardScope = (typeof LEADERBOARD_SCOPES)[number];

export const leaderboardQuerySchema = z.object({ scope: z.enum(LEADERBOARD_SCOPES).default("friends") }).strict();

export interface LeaderboardUser {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export interface LeaderboardEntry {
  rank: number;
  user: LeaderboardUser;
  /** XP earned this week. */
  weeklyXp: number;
  level: number;
}

export interface LeaderboardView {
  scope: LeaderboardScope;
  /** Monday 00:00 UTC of the current week, and when it ends. */
  weekStart: string;
  weekEnd: string;
  entries: LeaderboardEntry[];
  /** The viewer's own row (also when outside the top list); null with no XP this week. */
  me: LeaderboardEntry | null;
}

/** Number of rows a leaderboard shows. */
export const LEADERBOARD_SIZE = 20;

// -------------------------------------------------------------------------------------------------
// Sessions (API)
// -------------------------------------------------------------------------------------------------

export const SESSION_KINDS = ["pair", "battle"] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

/** Sessions (and unanswered invitations) expire after this long. */
export const SESSION_TTL_SECONDS = 2 * 60 * 60;
/** An invitation nobody answered is withdrawn after this long. */
export const INVITE_TTL_SECONDS = 10 * 60;

export const createSessionRequestSchema = z
  .object({
    kind: z.enum(SESSION_KINDS),
    lessonId: z.uuid(),
    /** The friend to invite. */
    friendId: z.uuid(),
  })
  .strict();
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export interface SessionParty {
  id: string;
  username: string;
  displayName: string;
}

export interface AcademySessionView {
  id: string;
  kind: SessionKind;
  lesson: { id: string; title: string };
  host: SessionParty;
  guest: SessionParty;
  createdAt: string;
}

/** Returned when creating or joining a session: connect to `ACADEMY_ROOM` with the ticket. */
export interface SessionJoinResponse {
  session: AcademySessionView;
  ticket: string;
  gameServerUrl: string;
}

// -------------------------------------------------------------------------------------------------
// Room tickets
// -------------------------------------------------------------------------------------------------

/** Room name on the game server. */
export const ACADEMY_ROOM = "academy";
/** Audience of academy room tickets, so they can't be used to join a zone (and vice versa). */
export const ACADEMY_TICKET_AUDIENCE = "entroworld:academy";

export const academyTicketClaimsSchema = z.object({
  sub: z.uuid(),
  username: z.string(),
  displayName: z.string(),
  sessionId: z.uuid(),
  kind: z.enum(SESSION_KINDS),
  lessonId: z.uuid(),
  /** Both members of the session; anyone else is turned away. */
  members: z.array(z.uuid()).length(2),
  jti: z.string().min(8),
});
export type AcademyTicketClaims = z.infer<typeof academyTicketClaimsSchema>;

// -------------------------------------------------------------------------------------------------
// Room protocol
// -------------------------------------------------------------------------------------------------

export const SessionClientMessage = {
  /** Sent once handlers are attached: the room answers with the state (and program). */
  Sync: "sync",
  /** Pair: the driver's workspace changed (whole program; sessions are two people). */
  Edit: "edit",
  /** Pair: the driver hands the keyboard to the partner. */
  Swap: "swap",
  /** Pair: the driver ran the program; partners see the robot do the same. */
  Run: "run",
  /** Battle: ready to start (both ready starts the countdown). */
  Ready: "ready",
  /** Battle: an attempt's action log, replayed by the room. */
  Submit: "submit",
  /** Battle: ask for a rematch after a finished race. */
  Rematch: "rematch",
} as const;

export const SessionServerMessage = {
  /** Full session snapshot (members, roles, battle phase). Sent on every change. */
  State: "state",
  /** Pair: the program as the driver last left it. */
  Program: "program",
  /** Pair: the driver ran the program. */
  Run: "run",
  /** Battle: the verdict on your own submission. */
  Verdict: "verdict",
  Error: "error",
} as const;

/** Max serialized workspace size kept in sync. */
export const MAX_SESSION_PROGRAM_LENGTH = MAX_DRAFT_CODE_LENGTH;

export const sessionEditSchema = z.object({ program: z.string().max(MAX_SESSION_PROGRAM_LENGTH) }).strict();
export const sessionActionsSchema = z.object({ actions: z.array(robotActionSchema).max(MAX_ACTION_LOG) }).strict();
export const sessionEmptySchema = z.object({}).strict();

export interface SessionMemberView {
  userId: string;
  displayName: string;
  connected: boolean;
}

export type BattlePhase = "waiting" | "countdown" | "racing" | "finished";

export interface BattlePlayerView {
  userId: string;
  ready: boolean;
  attempts: number;
  solved: boolean;
  /** Moves used by the winning attempt. */
  actionCount: number | null;
  /** Milliseconds from the start to the solve. */
  timeMs: number | null;
}

export interface BattleView {
  phase: BattlePhase;
  /** Epoch ms the race starts (countdown) or started (racing / finished). */
  startsAt: number | null;
  winnerId: string | null;
  players: BattlePlayerView[];
}

export interface SessionStateView {
  sessionId: string;
  kind: SessionKind;
  lesson: { id: string; title: string };
  members: SessionMemberView[];
  /** Pair: who edits right now. */
  driverId: string | null;
  battle: BattleView | null;
}

export interface SessionProgramPayload {
  program: string;
  /** Increases with every edit, so late echoes can be ignored. */
  version: number;
  by: string;
}

export interface SessionRunPayload {
  by: string;
  actions: z.infer<typeof robotActionSchema>[];
}

export interface BattleVerdictPayload {
  success: boolean;
  failureReason: string | null;
  actionCount: number;
  /** You solved it first. */
  won: boolean;
}

/** Battles count down this long once both players are ready. */
export const BATTLE_COUNTDOWN_MS = 3000;
