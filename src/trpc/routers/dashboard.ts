/**
 * SOURCE OF TRUTH KEYWORDS:⁠​‌‌​​‌‌​​‌​‌‌‌​​‌‌​‌​​​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​‌‌‌‌​​​‌​​‌​‌​​​‌​​‌‌‌⁠ dashboardRouter, dashboard.courses,
 *   dashboard.activity, dashboard.usage, dashboard.setup, studio home,
 *   COURSE_STATUS_GROUPS
 *
 * WHAT:  The studio home page data, one procedure per card: course pipeline
 *        and produced content, recent generation jobs, AI usage over 7 or 30
 *        days, and the getting-started checklist. KPIs carry "this week" and
 *        previous-period figures for the trend badges.
 * WHY:   One procedure per card so each carries its own permission
 *        (courses:read, generationJobs:read, aiProviders:read); a member
 *        without one of them simply does not see that card. All read-only, so
 *        protectedProcedure adds no audit rows. Statuses are grouped the way an
 *        author thinks about them (in progress, in review, ready, failed).
 * WHERE: Mounted as `dashboard`; used by /dashboard.
 */

import { z } from 'zod'

import { AiCapability, CourseStatus } from '@/generated/prisma'
import { createTRPCRouter } from '../init'
import { protectedProcedure } from '../procedures'
import { permissions } from '@/lib/permissions'
import { dashboardUsageSchema } from '@/lib/types'
import { hasRouteFor } from '@/lib/ai'
import * as dashboardService from '@/services/dashboard.service'

const orgInput = z.object({ organizationId: z.string().min(1) })
const RECENT_COURSES = 5
const RECENT_JOBS = 6
const TOP_MODELS = 5
const DAY_MS = 86_400_000

const COURSE_STATUS_GROUPS = {
  inProgress: [CourseStatus.DRAFT, CourseStatus.RESEARCHING, CourseStatus.CURRICULUM_REVIEW, CourseStatus.GENERATING],
  inReview: [CourseStatus.REVIEW],
  ready: [CourseStatus.READY],
  failed: [CourseStatus.FAILED],
} as const satisfies Record<string, readonly CourseStatus[]>

/* Midnight UTC `days - 1` days ago, so the range includes today. */
function rangeStart(days: number): Date {
  const today = new Date()
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) - (days - 1) * DAY_MS)
}

export const dashboardRouter = createTRPCRouter({
  courses: protectedProcedure({ requirePermission: permissions.COURSES_READ })
    .input(orgInput)
    .query(async ({ ctx, input }) => {
      const [byStatus, content, recent] = await Promise.all([
        dashboardService.countCoursesByStatus(ctx.db, input.organizationId),
        dashboardService.countProducedContent(ctx.db, input.organizationId, rangeStart(7)),
        dashboardService.listRecentCourses(ctx.db, input.organizationId, RECENT_COURSES),
      ])
      const count = (statuses: readonly CourseStatus[]) =>
        byStatus.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0)
      return {
        total: byStatus.reduce((sum, row) => sum + row._count._all, 0),
        inProgress: count(COURSE_STATUS_GROUPS.inProgress),
        inReview: count(COURSE_STATUS_GROUPS.inReview),
        ready: count(COURSE_STATUS_GROUPS.ready),
        failed: count(COURSE_STATUS_GROUPS.failed),
        lectures: content.lectures,
        lecturesThisWeek: content.recentLectures,
        videos: content.videos,
        videoMinutes: Math.round(content.videoMs / 60_000),
        videoMinutesThisWeek: Math.round(content.recentVideoMs / 60_000),
        recent: recent.map((course) => ({
          id: course.id,
          title: course.title,
          status: course.status,
          approved: course.curriculumApprovedAt !== null,
          updatedAt: course.updatedAt,
          lessons: course._count.lessons,
          written: course.lessons.length,
        })),
      }
    }),

  activity: protectedProcedure({ requirePermission: permissions.GENERATION_JOBS_READ })
    .input(orgInput)
    .query(({ ctx, input }) => dashboardService.listRecentJobs(ctx.db, input.organizationId, RECENT_JOBS)),

  usage: protectedProcedure({ requirePermission: permissions.AI_PROVIDERS_READ })
    .input(dashboardUsageSchema)
    .query(async ({ ctx, input }) => {
      const since = rangeStart(input.days)
      const previousSince = new Date(since.getTime() - input.days * DAY_MS)
      const { totals, previous, failed, byModel, daily } = await dashboardService.summarizeUsageSince(
        ctx.db,
        input.organizationId,
        since,
        previousSince
      )
      /* Every day in range, zero-filled, so the chart's x axis never skips. */
      const perDay = new Map(daily.map((row) => [row.day.toISOString().slice(0, 10), row]))
      const days = Array.from({ length: input.days }, (_, i) => {
        const date = new Date(since.getTime() + i * DAY_MS).toISOString().slice(0, 10)
        const row = perDay.get(date)
        return { date, calls: row?.calls ?? 0, input: Number(row?.input ?? 0), output: Number(row?.output ?? 0) }
      })
      const tokens = (totals._sum.inputTokens ?? 0) + (totals._sum.outputTokens ?? 0)
      const previousTokens = (previous._sum.inputTokens ?? 0) + (previous._sum.outputTokens ?? 0)
      return {
        days,
        tokens,
        /* Percent change against the previous period; null when it had none. */
        tokensChange: previousTokens > 0 ? Math.round(((tokens - previousTokens) / previousTokens) * 100) : null,
        calls: totals._count._all,
        failed,
        inputTokens: totals._sum.inputTokens ?? 0,
        outputTokens: totals._sum.outputTokens ?? 0,
        costMicros: totals._sum.costMicros ?? BigInt(0),
        models: byModel
          .map((row) => ({
            model: row.modelName,
            calls: row._count._all,
            tokens: (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0),
          }))
          .sort((a, b) => b.tokens - a.tokens)
          .slice(0, TOP_MODELS),
      }
    }),

  /* Getting-started steps; the page hides the card once all are done. */
  setup: protectedProcedure()
    .input(orgInput)
    .query(async ({ ctx, input }) => {
      const [textModel, voiceModel, byStatus] = await Promise.all([
        hasRouteFor(ctx.db, input.organizationId, AiCapability.STRONG_REASONING),
        hasRouteFor(ctx.db, input.organizationId, AiCapability.TTS),
        dashboardService.countCoursesByStatus(ctx.db, input.organizationId),
      ])
      const courses = byStatus.reduce((sum, row) => sum + row._count._all, 0)
      const finished = byStatus
        .filter((row) => row.status === CourseStatus.REVIEW || row.status === CourseStatus.READY)
        .reduce((sum, row) => sum + row._count._all, 0)
      return { textModel, voiceModel, hasCourse: courses > 0, hasFinishedCourse: finished > 0 }
    }),
})
