import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: enqueuePlanCourse, enqueueReadBook,
 *   approveAndBuild, PLAN_COURSE DAG, READ_BOOK DAG, BOOK_PAGES_PER_TASK,
 *   book-first autopilot
 *
 * WHAT:  Queues the planning job (optionally led by the Brief Writer), the
 *        scanned-book reading job (page ranges → assembler), and the
 *        autopilot step that approves a planned curriculum and starts the
 *        lesson build.
 * WHY:   One place builds these DAGs for the router (Plan curriculum, book
 *        upload) and for the job completion hooks (autopilot chains reading →
 *        planning → building with no clicks). Each checks that a model is
 *        routed first, so the user gets the reason instead of a failed job.
 * WHERE: courses.generate, courseBooks.upload, src/lib/generation/hooks.ts.
 */

import { TRPCError } from '@trpc/server'

import { AiCapability, CourseStatus, JobKind, JobStatus } from '@/generated/prisma'
import type { DbClient } from '@/lib/config'
import type { AgentTaskSpec } from '@/lib/types'
import { AiGatewayError, resolveModelsForCall } from '@/lib/ai'
import { createGenerationJob } from '@/lib/generation'
import * as courseService from '@/services/course.service'
import * as generationService from '@/services/generation.service'
import { enqueueBuildCourse } from './build-course'

/* Small ranges: each is one retryable task of a few model calls. */
const BOOK_PAGES_PER_TASK = 8

interface JobOwner {
  organizationId: string
  courseId: string
  createdById: string
}

async function requireRoute(db: DbClient, organizationId: string, capability: AiCapability) {
  try {
    await resolveModelsForCall(db, { organizationId, capability, agentId: null })
  } catch (error) {
    if (error instanceof AiGatewayError) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message })
    throw error
  }
}

export async function enqueuePlanCourse(db: DbClient, params: JobOwner & { writeBrief: boolean }) {
  await requireRoute(db, params.organizationId, AiCapability.STRONG_REASONING)

  /* A re-plan supersedes the previous plan's approval request. */
  const previous = await generationService.findLatestCourseJob(db, params.courseId, JobKind.PLAN_COURSE)
  if (previous?.status === JobStatus.AWAITING_APPROVAL) {
    await generationService.transitionJob(db, previous.id, [JobStatus.AWAITING_APPROVAL], {
      status: JobStatus.CANCELLED,
      finishedAt: new Date(),
    })
  }

  const input = { courseId: params.courseId }
  const lead: AgentTaskSpec[] = params.writeBrief ? [{ key: 'brief', agentId: 'briefWriter', dependsOn: [], input }] : []
  const job = await createGenerationJob(db, {
    organizationId: params.organizationId,
    courseId: params.courseId,
    createdById: params.createdById,
    kind: JobKind.PLAN_COURSE,
    scope: null,
    tasks: [
      ...lead,
      { key: 'research', agentId: 'research', dependsOn: params.writeBrief ? ['brief'] : [], input },
      { key: 'curriculum', agentId: 'curriculumArchitect', dependsOn: ['research'], input },
    ],
  })
  await courseService.setCourseStatus(db, params.courseId, CourseStatus.RESEARCHING)
  return job
}

export async function enqueueReadBook(db: DbClient, params: JobOwner & { pageCount: number }) {
  await requireRoute(db, params.organizationId, AiCapability.VISION)
  const ranges: AgentTaskSpec[] = []
  for (let start = 1; start <= params.pageCount; start += BOOK_PAGES_PER_TASK) {
    const endPage = Math.min(params.pageCount, start + BOOK_PAGES_PER_TASK - 1)
    ranges.push({
      key: `pages:${start}`,
      agentId: 'bookPageReader',
      dependsOn: [],
      input: { courseId: params.courseId, startPage: start, endPage },
    })
  }
  return createGenerationJob(db, {
    organizationId: params.organizationId,
    courseId: params.courseId,
    createdById: params.createdById,
    kind: JobKind.READ_BOOK,
    scope: null,
    tasks: [
      ...ranges,
      { key: 'assemble', agentId: 'bookAssembler', dependsOn: ranges.map((r) => r.key), input: { courseId: params.courseId } },
    ],
  })
}

/** Autopilot: approve the planned curriculum and start building lessons. */
export async function approveAndBuild(db: DbClient, params: JobOwner) {
  await courseService.updateCourse(db, params.organizationId, params.courseId, { curriculumApprovedAt: new Date() })
  return enqueueBuildCourse(db, params)
}
