/**
 * SOURCE OF TRUTH KEYWORDS: JOB_KIND_LABELS, generation job names, job kind
 *   display label, JOB_STATUS_LABELS
 *
 * WHAT:  Human names for generation job kinds and statuses.
 * WHY:   Activity lists name jobs as things that happened ("Lesson build"),
 *        unlike the workspace menu, which names actions ("Generate lessons").
 *        Typed by the Prisma enums, so a new kind fails the build until named.
 * WHERE: Dashboard activity card; any future job list.
 */

import type { JobKind, JobStatus } from '@/generated/prisma'

export const JOB_KIND_LABELS: Record<JobKind, string> = {
  PLAN_COURSE: 'Curriculum planning',
  BUILD_COURSE: 'Lesson build',
  REGENERATE: 'Regeneration',
  RENDER_VISUALS: 'Visual render',
  RENDER_NARRATION: 'Narration',
  RENDER_VIDEO: 'Video render',
  BUILD_MATERIALS: 'Downloads build',
  EXPORT_COURSE: 'Course export',
  EXPORT_SCORM: 'SCORM export',
  READ_BOOK: 'Book reading',
  PUBLISH_COURSE: 'Publishing',
}

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  AWAITING_APPROVAL: 'Awaiting approval',
  SUCCEEDED: 'Done',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
}
