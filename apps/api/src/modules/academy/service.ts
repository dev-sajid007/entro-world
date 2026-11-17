import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { badges, learningTracks, lessonProgress, lessons, userBadges, userLearningStats, type DbExecutor } from "@entroworld/database";
import { replay } from "@entroworld/puzzle-engine";
import {
  levelForXp,
  levelProgress,
  nextStreak,
  type AcademyProgressView,
  type BadgeCriteria,
  type BadgeView,
  type LearningStatsView,
  type LessonAttemptRequest,
  type LessonAttemptResponse,
  type LessonProgressView,
  type LessonSummaryView,
  type LessonView,
  type SaveCodeRequest,
  type TrackView,
} from "@entroworld/robot-api";
import type { AppContext } from "../../context";
import { notFound, tooManyRequests } from "../../lib/errors";

type TrackRow = typeof learningTracks.$inferSelect;
type LessonRow = typeof lessons.$inferSelect;
type ProgressRow = typeof lessonProgress.$inferSelect;
type StatsRow = typeof userLearningStats.$inferSelect;

/** Attempts allowed per user and lesson per minute (SPEC-ADDENDUM-01 §4.5). */
const ATTEMPTS_PER_MINUTE = 20;

const summary = (l: LessonRow): LessonSummaryView => ({
  id: l.id,
  slug: l.slug,
  title: l.title,
  concept: l.content.concept,
  orderIndex: l.orderIndex,
  xpReward: l.xpReward,
});

const progressView = (p: ProgressRow): LessonProgressView => ({
  lessonId: p.lessonId,
  status: p.status,
  attempts: p.attempts,
  bestActionCount: p.bestActionCount,
  completedAt: p.completedAt?.toISOString() ?? null,
});

function statsView(s: StatsRow | undefined): LearningStatsView {
  const totalXp = s?.totalXp ?? 0;
  const { level, levelXp, levelSpan } = levelProgress(totalXp);
  return {
    totalXp,
    level,
    levelXp,
    levelSpan,
    currentStreak: s?.currentStreak ?? 0,
    longestStreak: s?.longestStreak ?? 0,
    lastActivityDate: s?.lastActivityDate ?? null,
  };
}

const todayUtc = () => new Date().toISOString().slice(0, 10);

/**
 * Coding Academy (SPEC-ADDENDUM-01 §6). User code never reaches the server: clients submit the
 * action log their sandbox produced and the server replays it against the shared deterministic
 * puzzle simulation. Completion, XP, streak and badges are granted together, once per lesson.
 */
export class AcademyService {
  constructor(private readonly ctx: AppContext) {}

  private get db() {
    return this.ctx.db;
  }

  async tracks(): Promise<TrackView[]> {
    const tracks = await this.db.select().from(learningTracks).where(eq(learningTracks.isPublished, true)).orderBy(asc(learningTracks.orderIndex));
    if (tracks.length === 0) return [];
    const rows = await this.db
      .select()
      .from(lessons)
      .where(inArray(lessons.trackId, tracks.map((t) => t.id)))
      .orderBy(asc(lessons.orderIndex));
    return tracks.map((t) => this.trackView(t, rows.filter((l) => l.trackId === t.id)));
  }

  async track(slug: string): Promise<TrackView> {
    const [track] = await this.db.select().from(learningTracks).where(and(eq(learningTracks.slug, slug), eq(learningTracks.isPublished, true)));
    if (!track) throw notFound("Track");
    const rows = await this.db.select().from(lessons).where(eq(lessons.trackId, track.id)).orderBy(asc(lessons.orderIndex));
    return this.trackView(track, rows);
  }

  private trackView(t: TrackRow, rows: LessonRow[]): TrackView {
    return { id: t.id, slug: t.slug, title: t.title, description: t.description, level: t.level, lessons: rows.map(summary) };
  }

  /** A lesson of a published track. */
  private async lessonRow(lessonId: string): Promise<{ lesson: LessonRow; track: TrackRow }> {
    const [row] = await this.db
      .select({ lesson: lessons, track: learningTracks })
      .from(lessons)
      .innerJoin(learningTracks, eq(lessons.trackId, learningTracks.id))
      .where(and(eq(lessons.id, lessonId), eq(learningTracks.isPublished, true)));
    if (!row) throw notFound("Lesson");
    return row;
  }

  async lesson(userId: string, lessonId: string): Promise<LessonView> {
    const { lesson, track } = await this.lessonRow(lessonId);
    const [[progress], [next]] = await Promise.all([
      this.db.select().from(lessonProgress).where(and(eq(lessonProgress.userId, userId), eq(lessonProgress.lessonId, lessonId))),
      this.db
        .select({ id: lessons.id })
        .from(lessons)
        .where(and(eq(lessons.trackId, track.id), sql`${lessons.orderIndex} > ${lesson.orderIndex}`))
        .orderBy(asc(lessons.orderIndex))
        .limit(1),
    ]);
    return {
      ...summary(lesson),
      trackSlug: track.slug,
      content: lesson.content,
      puzzle: lesson.puzzleDefinition,
      progress: progress ? progressView(progress) : null,
      draft: progress?.lastCode != null && progress.lastEditorMode ? { code: progress.lastCode, editorMode: progress.lastEditorMode } : null,
      nextLessonId: next?.id ?? null,
    };
  }

  async progress(userId: string): Promise<AcademyProgressView> {
    const [[stats], rows] = await Promise.all([
      this.db.select().from(userLearningStats).where(eq(userLearningStats.userId, userId)),
      this.db.select().from(lessonProgress).where(eq(lessonProgress.userId, userId)),
    ]);
    return { stats: statsView(stats), lessons: rows.map(progressView) };
  }

  async badges(userId: string): Promise<BadgeView[]> {
    const rows = await this.db
      .select({ badge: badges, awardedAt: userBadges.awardedAt })
      .from(userBadges)
      .innerJoin(badges, eq(userBadges.badgeId, badges.id))
      .where(eq(userBadges.userId, userId))
      .orderBy(asc(userBadges.awardedAt));
    return rows.map(({ badge, awardedAt }) => ({
      slug: badge.slug,
      name: badge.name,
      description: badge.description,
      iconUrl: badge.iconUrl,
      awardedAt: awardedAt.toISOString(),
    }));
  }

  async saveCode(userId: string, lessonId: string, input: SaveCodeRequest): Promise<void> {
    await this.lessonRow(lessonId);
    await this.db
      .insert(lessonProgress)
      .values({ userId, lessonId, status: "in_progress", lastCode: input.code, lastEditorMode: input.editorMode })
      .onConflictDoUpdate({
        target: [lessonProgress.userId, lessonProgress.lessonId],
        set: { lastCode: input.code, lastEditorMode: input.editorMode, updatedAt: new Date() },
      });
  }

  private async rateLimit(userId: string, lessonId: string): Promise<void> {
    const key = `ew:academy:attempts:${userId}:${lessonId}`;
    const count = await this.ctx.redis.incr(key);
    if (count === 1) await this.ctx.redis.expire(key, 60);
    if (count > ATTEMPTS_PER_MINUTE) throw tooManyRequests("Too many attempts. Take a breath and try again in a minute.");
  }

  async attempt(userId: string, lessonId: string, input: LessonAttemptRequest): Promise<LessonAttemptResponse> {
    const { lesson } = await this.lessonRow(lessonId);
    await this.rateLimit(userId, lessonId);
    // The server's verdict comes only from replaying the action log.
    const result = replay(lesson.puzzleDefinition, input.actions);

    return this.db.transaction(async (tx) => {
      // Lock (or create) this user's progress row so concurrent attempts can't both "complete".
      await tx.insert(lessonProgress).values({ userId, lessonId, status: "in_progress" }).onConflictDoNothing();
      const [progress] = await tx
        .select()
        .from(lessonProgress)
        .where(and(eq(lessonProgress.userId, userId), eq(lessonProgress.lessonId, lessonId)))
        .for("update");
      const alreadyCompleted = progress!.status === "completed";
      const firstCompletion = result.success && !alreadyCompleted;
      const best =
        result.success && (progress!.bestActionCount === null || result.actionCount < progress!.bestActionCount) ? result.actionCount : progress!.bestActionCount;
      await tx
        .update(lessonProgress)
        .set({
          attempts: sql`${lessonProgress.attempts} + 1`,
          status: alreadyCompleted || result.success ? "completed" : "in_progress",
          bestActionCount: best,
          completedAt: firstCompletion ? new Date() : progress!.completedAt,
          updatedAt: new Date(),
        })
        .where(eq(lessonProgress.id, progress!.id));

      const response: LessonAttemptResponse = {
        success: result.success,
        xpAwarded: 0,
        badgesAwarded: [],
        worldEffects: result.success ? lesson.content.unlocks : [],
        firstCompletion,
        actionCount: result.actionCount,
      };
      if (result.failureReason) response.failureReason = result.failureReason;
      if (!result.success) return response;

      await this.recordActivity(tx, userId, firstCompletion ? lesson.xpReward : 0);
      if (firstCompletion) {
        response.xpAwarded = lesson.xpReward;
        response.badgesAwarded = await this.awardBadges(tx, userId);
      }
      return response;
    });
  }

  /** Adds XP and extends the daily streak (any solved puzzle counts as activity). */
  private async recordActivity(tx: DbExecutor, userId: string, xp: number): Promise<void> {
    await tx.insert(userLearningStats).values({ userId }).onConflictDoNothing();
    const [stats] = await tx.select().from(userLearningStats).where(eq(userLearningStats.userId, userId)).for("update");
    const today = todayUtc();
    const streak = nextStreak(stats!.currentStreak, stats!.lastActivityDate, today);
    const totalXp = stats!.totalXp + xp;
    await tx
      .update(userLearningStats)
      .set({
        totalXp,
        level: levelForXp(totalXp),
        currentStreak: streak,
        longestStreak: Math.max(stats!.longestStreak, streak),
        lastActivityDate: today,
        updatedAt: new Date(),
      })
      .where(eq(userLearningStats.userId, userId));
  }

  /** Grants every badge whose criteria are now met; returns the newly awarded slugs. */
  private async awardBadges(tx: DbExecutor, userId: string): Promise<string[]> {
    // Sequential: a transaction runs on one connection.
    const all = await tx.select().from(badges);
    const owned = await tx.select({ badgeId: userBadges.badgeId }).from(userBadges).where(eq(userBadges.userId, userId));
    const completed = await tx
      .select({ slug: lessons.slug, trackSlug: learningTracks.slug })
      .from(lessonProgress)
      .innerJoin(lessons, eq(lessonProgress.lessonId, lessons.id))
      .innerJoin(learningTracks, eq(lessons.trackId, learningTracks.id))
      .where(and(eq(lessonProgress.userId, userId), eq(lessonProgress.status, "completed")));
    const ownedIds = new Set(owned.map((o) => o.badgeId));
    const doneSlugs = new Set(completed.map((c) => c.slug));
    const trackTotals = new Map<string, number>();
    const needsTrack = all.some((b) => b.criteria.type === "track_completed");
    if (needsTrack) {
      const counts = await tx
        .select({ slug: learningTracks.slug, count: sql<number>`count(${lessons.id})::int` })
        .from(learningTracks)
        .innerJoin(lessons, eq(lessons.trackId, learningTracks.id))
        .groupBy(learningTracks.slug);
      for (const c of counts) trackTotals.set(c.slug, c.count);
    }
    const met = (criteria: BadgeCriteria): boolean => {
      switch (criteria.type) {
        case "lessons_completed":
          return doneSlugs.size >= criteria.count;
        case "lessons_set":
          return criteria.lessons.every((s) => doneSlugs.has(s));
        case "track_completed": {
          const total = trackTotals.get(criteria.track) ?? 0;
          return total > 0 && completed.filter((c) => c.trackSlug === criteria.track).length >= total;
        }
      }
    };
    const earned = all.filter((b) => !ownedIds.has(b.id) && met(b.criteria));
    if (earned.length === 0) return [];
    const inserted = await tx
      .insert(userBadges)
      .values(earned.map((b) => ({ userId, badgeId: b.id })))
      .onConflictDoNothing()
      .returning({ badgeId: userBadges.badgeId });
    const insertedIds = new Set(inserted.map((r) => r.badgeId));
    return earned.filter((b) => insertedIds.has(b.id)).map((b) => b.slug);
  }
}
