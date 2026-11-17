import type { EditorMode } from "./actions";
import type { LessonContent, PuzzleDefinition } from "./puzzle";

/** Client-facing shapes of the Academy API (SPEC-ADDENDUM-01 §6). */

export type TrackLevel = "beginner" | "intermediate" | "advanced";
export type LessonStatus = "not_started" | "in_progress" | "completed";

export interface LessonSummaryView {
  id: string;
  slug: string;
  title: string;
  concept: string;
  orderIndex: number;
  xpReward: number;
}

export interface TrackView {
  id: string;
  slug: string;
  title: string;
  description: string;
  level: TrackLevel;
  lessons: LessonSummaryView[];
}

export interface LessonProgressView {
  lessonId: string;
  status: LessonStatus;
  attempts: number;
  bestActionCount: number | null;
  completedAt: string | null;
}

export interface LessonView extends LessonSummaryView {
  trackSlug: string;
  content: LessonContent;
  puzzle: PuzzleDefinition;
  progress: LessonProgressView | null;
  /** The viewer's saved draft, if any. */
  draft: { code: string; editorMode: EditorMode } | null;
  nextLessonId: string | null;
}

export interface LearningStatsView {
  totalXp: number;
  level: number;
  /** XP earned inside the current level, and the XP the level spans. */
  levelXp: number;
  levelSpan: number;
  currentStreak: number;
  longestStreak: number;
  lastActivityDate: string | null;
}

export interface AcademyProgressView {
  stats: LearningStatsView;
  lessons: LessonProgressView[];
}

export interface BadgeView {
  slug: string;
  name: string;
  description: string;
  iconUrl: string | null;
  awardedAt: string;
}

/** How a badge is earned (`badges.criteria`). */
export type BadgeCriteria =
  | { type: "lessons_completed"; count: number }
  /** All of these lessons (by slug) completed. */
  | { type: "lessons_set"; lessons: string[] }
  /** Every lesson of a track completed. */
  | { type: "track_completed"; track: string };
