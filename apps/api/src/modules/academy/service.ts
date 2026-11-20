import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { academyXpEvents, badges, learningTracks, lessonProgress, lessons, profiles, userBadges, userLearningStats, users, type DbExecutor } from "@entroworld/database";
import { describeBoard, replay } from "@entroworld/puzzle-engine";
import type { TutorLessonContext } from "@entroworld/agent-protocol";
import {
  LEADERBOARD_SIZE,
  levelForXp,
  levelProgress,
  nextStreak,
  type AcademyAchievementsView,
  type AcademyProgressView,
  type BadgeCriteria,
  type BadgeView,
  type LeaderboardEntry,
  type LeaderboardScope,
  type LeaderboardView,
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
import { friendsSql, notBlockedSql, visibleAccount } from "../social/relationships";

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

/** Monday 00:00 UTC of the week containing `now`. Weekly leaderboards reset then. */
export function weekStartUtc(now: Date): Date {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sinceMonday = (start.getUTCDay() + 6) % 7;
  start.setUTCDate(start.getUTCDate() - sinceMonday);
  return start;
}

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

  /** A lesson described for the AI tutor, from trusted data only. */
  async tutorContext(lessonId: string): Promise<TutorLessonContext> {
    const { lesson } = await this.lessonRow(lessonId);
    const p = lesson.puzzleDefinition;
    return {
      title: lesson.title,
      concept: lesson.content.concept,
      instructions: lesson.content.instructions,
      hints: lesson.content.hints,
      board: describeBoard(p),
      allowedApi: p.allowedApi,
      controls: p.controls,
      maxBlocks: p.maxBlocks,
      maxActions: p.maxActions,
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

  /** Level, XP and badges for a profile page (the caller checks the profile is visible). */
  async achievements(userId: string): Promise<AcademyAchievementsView> {
    const [[stats], badgeList, [done]] = await Promise.all([
      this.db.select().from(userLearningStats).where(eq(userLearningStats.userId, userId)),
      this.badges(userId),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(lessonProgress)
        .where(and(eq(lessonProgress.userId, userId), eq(lessonProgress.status, "completed"))),
    ]);
    const totalXp = stats?.totalXp ?? 0;
    return { level: levelForXp(totalXp), totalXp, lessonsCompleted: done?.count ?? 0, badges: badgeList };
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

      await this.recordActivity(tx, userId, firstCompletion ? lesson.xpReward : 0, lessonId);
      if (firstCompletion) {
        response.xpAwarded = lesson.xpReward;
        response.badgesAwarded = await this.awardBadges(tx, userId);
      }
      return response;
    });
  }

  /** Adds XP and extends the daily streak (any solved puzzle counts as activity). */
  private async recordActivity(tx: DbExecutor, userId: string, xp: number, lessonId: string): Promise<void> {
    if (xp > 0) await tx.insert(academyXpEvents).values({ userId, xp, lessonId });
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

  /**
   * XP earned this week (Monday to Monday, UTC): the viewer and their friends, or everyone. Users
   * either side has blocked are left out. Returns the top rows plus the viewer's own row.
   */
  async leaderboard(viewerId: string, scope: LeaderboardScope, now = new Date()): Promise<LeaderboardView> {
    const start = weekStartUtc(now);
    const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    const inScope = scope === "friends" ? sql`(${academyXpEvents.userId} = ${viewerId} or ${friendsSql(viewerId, academyXpEvents.userId)})` : sql`true`;
    const weekly = this.db.$with("weekly").as(
      this.db
        .select({
          userId: academyXpEvents.userId,
          xp: sql<number>`sum(${academyXpEvents.xp})::int`.as("xp"),
          // Ties go to whoever got there first.
          reachedAt: sql<Date>`max(${academyXpEvents.createdAt})`.as("reached_at"),
        })
        .from(academyXpEvents)
        .innerJoin(users, eq(users.id, academyXpEvents.userId))
        .where(and(sql`${academyXpEvents.createdAt} >= ${start.toISOString()}`, inScope, visibleAccount, notBlockedSql(viewerId, academyXpEvents.userId)))
        .groupBy(academyXpEvents.userId),
    );
    const ranked = this.db.$with("ranked").as(
      this.db
        .with(weekly)
        .select({
          userId: weekly.userId,
          xp: weekly.xp,
          rank: sql<number>`rank() over (order by ${weekly.xp} desc)::int`.as("rank"),
          position: sql<number>`row_number() over (order by ${weekly.xp} desc, ${weekly.reachedAt} asc)::int`.as("position"),
        })
        .from(weekly),
    );
    const rows = await this.db
      .with(weekly, ranked)
      .select({
        userId: ranked.userId,
        xp: ranked.xp,
        rank: ranked.rank,
        position: ranked.position,
        username: users.username,
        displayName: users.displayName,
        avatarUrl: profiles.avatarUrl,
        level: userLearningStats.level,
      })
      .from(ranked)
      .innerJoin(users, eq(users.id, ranked.userId))
      .leftJoin(profiles, eq(profiles.userId, ranked.userId))
      .leftJoin(userLearningStats, eq(userLearningStats.userId, ranked.userId))
      .where(sql`${ranked.position} <= ${LEADERBOARD_SIZE} or ${ranked.userId} = ${viewerId}`)
      .orderBy(asc(ranked.position));
    const entry = (r: (typeof rows)[number]): LeaderboardEntry => ({
      rank: r.rank,
      user: { id: r.userId, username: r.username, displayName: r.displayName, avatarUrl: r.avatarUrl ?? null },
      weeklyXp: r.xp,
      level: r.level ?? 1,
    });
    const mine = rows.find((r) => r.userId === viewerId);
    return {
      scope,
      weekStart: start.toISOString(),
      weekEnd: end.toISOString(),
      entries: rows.filter((r) => r.position <= LEADERBOARD_SIZE).map(entry),
      me: mine ? entry(mine) : null,
    };
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
