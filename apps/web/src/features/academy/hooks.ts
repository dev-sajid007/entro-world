import { useQuery } from "@tanstack/react-query";
import type {
  AcademyProgressView,
  AcademySessionView,
  CreateSessionRequest,
  LeaderboardScope,
  LeaderboardView,
  SessionJoinResponse,
  BadgeView,
  LessonAttemptRequest,
  LessonAttemptResponse,
  LessonView,
  SaveCodeRequest,
  TrackView,
} from "@entroworld/robot-api";
import { api } from "../../lib/api";
import { queryClient } from "../../lib/queryClient";

export const academyKeys = {
  tracks: ["academy", "tracks"] as const,
  lesson: (id: string) => ["academy", "lesson", id] as const,
  progress: ["academy", "progress"] as const,
  badges: ["academy", "badges"] as const,
};

export const useTracks = () =>
  useQuery({ queryKey: academyKeys.tracks, queryFn: async () => (await api.get<{ tracks: TrackView[] }>("/academy/tracks")).tracks, staleTime: 10 * 60_000 });

export const useLesson = (id: string) =>
  useQuery({
    queryKey: academyKeys.lesson(id),
    queryFn: async () => (await api.get<{ lesson: LessonView }>(`/academy/lessons/${encodeURIComponent(id)}`)).lesson,
    // The draft inside changes as the learner edits; the editor keeps its own copy meanwhile.
    staleTime: Infinity,
  });

export const useAcademyProgress = () =>
  useQuery({ queryKey: academyKeys.progress, queryFn: () => api.get<AcademyProgressView>("/academy/progress/me"), staleTime: 30_000 });

export const useAcademyBadges = () =>
  useQuery({ queryKey: academyKeys.badges, queryFn: async () => (await api.get<{ badges: BadgeView[] }>("/academy/badges/me")).badges, staleTime: 60_000 });

export async function submitAttempt(lessonId: string, body: LessonAttemptRequest): Promise<LessonAttemptResponse> {
  const result = await api.post<LessonAttemptResponse>(`/academy/lessons/${encodeURIComponent(lessonId)}/attempts`, body);
  void queryClient.invalidateQueries({ queryKey: academyKeys.progress });
  if (result.badgesAwarded.length > 0) void queryClient.invalidateQueries({ queryKey: academyKeys.badges });
  return result;
}

export async function saveDraft(lessonId: string, body: SaveCodeRequest): Promise<void> {
  await api.put<void>(`/academy/lessons/${encodeURIComponent(lessonId)}/code`, body);
  // Reopening the lesson later should start from this draft.
  queryClient.setQueryData<LessonView>(academyKeys.lesson(lessonId), (l) => (l ? { ...l, draft: { code: body.code, editorMode: body.editorMode } } : l));
}

// -------------------------------------------------------------------------------------------------
// Social learning: leaderboards and sessions with friends
// -------------------------------------------------------------------------------------------------

export const socialKeys = {
  leaderboard: (scope: LeaderboardScope) => ["academy", "leaderboard", scope] as const,
  invites: ["academy", "invites"] as const,
};

export const useLeaderboard = (scope: LeaderboardScope) =>
  useQuery({ queryKey: socialKeys.leaderboard(scope), queryFn: () => api.get<LeaderboardView>(`/academy/leaderboard?scope=${scope}`), staleTime: 30_000 });

export const useSessionInvites = () =>
  useQuery({
    queryKey: socialKeys.invites,
    queryFn: async () => (await api.get<{ invites: AcademySessionView[] }>("/academy/sessions/invites")).invites,
    refetchInterval: 20_000,
  });

export const createSession = (body: CreateSessionRequest) => api.post<SessionJoinResponse>("/academy/sessions", body);

export async function joinSession(sessionId: string): Promise<SessionJoinResponse> {
  const result = await api.post<SessionJoinResponse>(`/academy/sessions/${encodeURIComponent(sessionId)}/join`);
  void queryClient.invalidateQueries({ queryKey: socialKeys.invites });
  return result;
}

export async function leaveSession(sessionId: string): Promise<void> {
  await api.delete<void>(`/academy/sessions/${encodeURIComponent(sessionId)}`);
  void queryClient.invalidateQueries({ queryKey: socialKeys.invites });
}
