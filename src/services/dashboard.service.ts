import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: dashboard.service, countCoursesByStatus,
 *   countProducedContent, listRecentCourses, listRecentJobs,
 *   summarizeUsageSince, studio overview data
 *
 * WHAT:  Read-only aggregates for the studio home page: courses by status,
 *        produced content (lectures written, videos and their minutes),
 *        recently updated courses, recent and running generation jobs, and
 *        AI usage events since a date.
 * WHY:   The only layer that queries the database; the dashboard router
 *        shapes these into the page's view models. Every query is scoped to
 *        one organization and uses counts or narrow selects, so the home page
 *        stays cheap however many courses a workspace has.
 * WHERE: src/trpc/routers/dashboard.ts.
 */

import { AssetKind, JobStatus } from '@/generated/prisma'
import type { DbClient } from '@/lib/config'

export function countCoursesByStatus(db: DbClient, organizationId: string) {
  return db.course.groupBy({ by: ['status'], where: { organizationId }, _count: { _all: true } })
}

/** Current lectures and their videos, in total and since `recentSince`. */
export async function countProducedContent(db: DbClient, organizationId: string, recentSince: Date) {
  const currentVideo = { organizationId, kind: AssetKind.VIDEO, videoFor: { some: { currentFor: { isNot: null } } } }
  const [lectures, recentLectures, videos, videoDuration, recentVideoDuration] = await Promise.all([
    db.lesson.count({ where: { organizationId, currentVersionId: { not: null } } }),
    db.lesson.count({ where: { organizationId, currentVersion: { createdAt: { gte: recentSince } } } }),
    db.lesson.count({ where: { organizationId, currentVersion: { videoAssetId: { not: null } } } }),
    db.asset.aggregate({ where: currentVideo, _sum: { durationMs: true } }),
    db.asset.aggregate({ where: { ...currentVideo, updatedAt: { gte: recentSince } }, _sum: { durationMs: true } }),
  ])
  return {
    lectures,
    recentLectures,
    videos,
    videoMs: videoDuration._sum.durationMs ?? 0,
    recentVideoMs: recentVideoDuration._sum.durationMs ?? 0,
  }
}

export function listRecentCourses(db: DbClient, organizationId: string, take: number) {
  return db.course.findMany({
    where: { organizationId },
    orderBy: { updatedAt: 'desc' },
    take,
    select: {
      id: true,
      title: true,
      status: true,
      curriculumApprovedAt: true,
      updatedAt: true,
      _count: { select: { lessons: true } },
      lessons: { where: { currentVersionId: { not: null } }, select: { id: true } },
    },
  })
}

const JOB_SELECT = {
  id: true,
  kind: true,
  status: true,
  totalTasks: true,
  completedTasks: true,
  failedTasks: true,
  createdAt: true,
  finishedAt: true,
  course: { select: { id: true, title: true } },
} as const

export async function listRecentJobs(db: DbClient, organizationId: string, take: number) {
  const [running, recent] = await Promise.all([
    db.generationJob.count({
      where: { organizationId, status: { in: [JobStatus.QUEUED, JobStatus.RUNNING] } },
    }),
    db.generationJob.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take, select: JOB_SELECT }),
  ])
  return { running, recent }
}

/** Totals, per-model and per-day AI usage since `since` (UTC days), plus the
 * token total of the equally long period before it (for the trend). */
export async function summarizeUsageSince(db: DbClient, organizationId: string, since: Date, previousSince: Date) {
  const where = { organizationId, createdAt: { gte: since } }
  const [totals, previous, failed, byModel, daily] = await Promise.all([
    db.aiUsageEvent.aggregate({ where, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true, costMicros: true } }),
    db.aiUsageEvent.aggregate({
      where: { organizationId, createdAt: { gte: previousSince, lt: since } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
    db.aiUsageEvent.count({ where: { ...where, success: false } }),
    db.aiUsageEvent.groupBy({
      by: ['modelName'],
      where,
      _count: { _all: true },
      _sum: { inputTokens: true, outputTokens: true, costMicros: true },
    }),
    db.$queryRaw<Array<{ day: Date; calls: number; input: bigint; output: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day,
             count(*)::int AS calls,
             coalesce(sum("inputTokens"), 0)::bigint AS input,
             coalesce(sum("outputTokens"), 0)::bigint AS output
        FROM ai_usage_event
       WHERE "organizationId" = ${organizationId} AND "createdAt" >= ${since}
       GROUP BY 1
       ORDER BY 1`,
  ])
  return { totals, previous, failed, byModel, daily }
}
