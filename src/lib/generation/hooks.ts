import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: JOB_COMPLETION_HOOKS, JobCompletionHooks,
 *   onSucceeded, onFailed, onReopened, onCancelled, PLAN_COURSE hooks,
 *   course status transitions
 *
 * WHAT:  What happens to Course State when a job of each kind settles, is
 *        reopened by a retry, or is cancelled.
 * WHY:   Keeps course-specific transitions (course status, approval gates)
 *        out of the generic lifecycle engine — adding a JobKind means adding
 *        an entry here, never editing lifecycle.ts. BUILD_COURSE arrives in
 *        build step 5.
 *
 *        PLAN_COURSE (research → curriculum):
 *          succeeded → course CURRICULUM_REVIEW, job AWAITING_APPROVAL
 *                      (courses.approve closes it)
 *          failed    → course FAILED (user can retry the failed task)
 *          reopened  → course RESEARCHING again
 *          cancelled → course back to CURRICULUM_REVIEW if a plan already
 *                      exists from an earlier run, else DRAFT
 *
 *        BUILD_COURSE (lesson packages):
 *          succeeded → deterministic quality report stored, course REVIEW
 *          failed    → report of what exists so far, course FAILED,
 *                      lessons left on Generating… → Ready for review
 *          reopened  → course GENERATING
 *          cancelled → course back to CURRICULUM_REVIEW (approved plan,
 *                      partial lessons kept as versions, Generating… →
 *                      Ready for review)
 *
 *        RENDER_VISUALS / RENDER_NARRATION / RENDER_VIDEO / BUILD_MATERIALS
 *        (media and downloads only):
 *          settled (any outcome) → readiness report refreshed; course status
 *                      unchanged — media never fails a course
 * WHERE: Read by src/lib/generation/lifecycle.ts.
 */

import { CourseStatus, JobStatus, type JobKind } from '@/generated/prisma'
import { prisma, type DbClient } from '@/lib/config'
import type { JobCompletionHooks } from '@/lib/types'
import * as courseService from '@/services/course.service'
import * as lessonService from '@/services/lesson.service'
import * as publishingService from '@/services/publishing.service'
import { computeCourseQualityReport } from '@/lib/courses/quality'

export const JOB_COMPLETION_HOOKS: Partial<Record<JobKind, JobCompletionHooks>> = {
  PLAN_COURSE: {
    onSucceeded: async (db, job) => {
      await courseService.setCourseStatus(db, job.courseId, CourseStatus.CURRICULUM_REVIEW)
      /* AUTOPILOT: book-first courses skip the review stop and build at once. */
      const course = await courseService.findCourse(db, job.organizationId, job.courseId)
      if (course?.autopilot && job.createdById) {
        const { approveAndBuild } = await import('@/lib/courses/plan-course')
        await prisma.$transaction((tx) =>
          approveAndBuild(tx, { organizationId: job.organizationId, courseId: job.courseId, createdById: job.createdById ?? '' })
        )
        return JobStatus.SUCCEEDED
      }
      return JobStatus.AWAITING_APPROVAL
    },
    onFailed: async (db, job) => {
      await courseService.setCourseStatus(db, job.courseId, CourseStatus.FAILED)
    },
    onReopened: async (db, job) => {
      await courseService.setCourseStatus(db, job.courseId, CourseStatus.RESEARCHING)
    },
    onCancelled: async (db, job) => {
      const lessons = await courseService.countLessons(db, job.courseId)
      await courseService.setCourseStatus(db, job.courseId, lessons > 0 ? CourseStatus.CURRICULUM_REVIEW : CourseStatus.DRAFT)
    },
  },
  BUILD_COURSE: {
    onSucceeded: async (db, job) => {
      const report = await computeCourseQualityReport(db, job.organizationId, job.courseId)
      await courseService.updateCourse(db, job.organizationId, job.courseId, {
        qualityReport: report,
        status: CourseStatus.REVIEW,
      })
    },
    onFailed: async (db, job) => {
      await lessonService.settleUnfinishedLessons(db, job.courseId)
      const report = await computeCourseQualityReport(db, job.organizationId, job.courseId)
      await courseService.updateCourse(db, job.organizationId, job.courseId, {
        qualityReport: report,
        status: CourseStatus.FAILED,
      })
    },
    onReopened: async (db, job) => {
      await courseService.setCourseStatus(db, job.courseId, CourseStatus.GENERATING)
    },
    onCancelled: async (db, job) => {
      await lessonService.settleUnfinishedLessons(db, job.courseId)
      await courseService.setCourseStatus(db, job.courseId, CourseStatus.CURRICULUM_REVIEW)
    },
  },
  RENDER_VISUALS: {
    onSucceeded: async (db, job) => {
      await refreshQualityReport(db, job.organizationId, job.courseId)
    },
    onFailed: async (db, job) => {
      await refreshQualityReport(db, job.organizationId, job.courseId)
    },
  },
  RENDER_NARRATION: {
    onSucceeded: async (db, job) => {
      await refreshQualityReport(db, job.organizationId, job.courseId)
    },
    onFailed: async (db, job) => {
      await refreshQualityReport(db, job.organizationId, job.courseId)
    },
  },
  RENDER_VIDEO: {
    onSucceeded: async (db, job) => {
      await refreshQualityReport(db, job.organizationId, job.courseId)
    },
    onFailed: async (db, job) => {
      await refreshQualityReport(db, job.organizationId, job.courseId)
    },
  },
  BUILD_MATERIALS: {
    onSucceeded: async (db, job) => {
      await refreshQualityReport(db, job.organizationId, job.courseId)
    },
    onFailed: async (db, job) => {
      await refreshQualityReport(db, job.organizationId, job.courseId)
    },
  },
  /* Scanned course books: once every page is read and chapters are built,
   * book-first (autopilot) courses go straight on to planning. */
  READ_BOOK: {
    onSucceeded: async (db, job) => {
      const course = await courseService.findCourse(db, job.organizationId, job.courseId)
      if (course?.autopilot && job.createdById) {
        const { enqueuePlanCourse } = await import('@/lib/courses/plan-course')
        await prisma.$transaction((tx) =>
          enqueuePlanCourse(tx, { organizationId: job.organizationId, courseId: job.courseId, createdById: job.createdById ?? '', writeBrief: true })
        )
      }
    },
  },
  /* The publication follows its job: failed, cancelled or reopened. Success
   * is written by the publisher itself, with the platform link. */
  PUBLISH_COURSE: {
    onFailed: async (db, job) => {
      const reason = await publishingService.findJobFailureReason(db, job.id)
      await publishingService.failPublicationForJob(db, job.id, reason ?? 'Publishing failed. Open Activity to see why.')
    },
    onCancelled: async (db, job) => {
      await publishingService.failPublicationForJob(db, job.id, 'Publishing was cancelled. Publish again to continue.')
    },
    onReopened: async (db, job) => {
      await publishingService.requeuePublicationForJob(db, job.id)
    },
  },
}

async function refreshQualityReport(db: DbClient, organizationId: string, courseId: string) {
  const report = await computeCourseQualityReport(db, organizationId, courseId)
  await courseService.updateCourse(db, organizationId, courseId, { qualityReport: report })
}
