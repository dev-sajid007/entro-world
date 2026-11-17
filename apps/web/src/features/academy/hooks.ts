import { useQuery } from "@tanstack/react-query";
import type {
  AcademyProgressView,
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
