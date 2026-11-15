import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: enqueuePublishCourse, PUBLISH_COURSE job,
 *   publish course job, coursePublisher task
 *
 * WHAT:  Queues a PUBLISH_COURSE job for one course and one connection: saves
 *        (or reuses) the CoursePublication with the chosen options and links
 *        it to the new job, whose single task is the coursePublisher.
 * WHY:   Publishing uploads for minutes, so it runs in the worker like every
 *        other long job, shows in the Activity tab, and retries there.
 *        Reusing the publication row keeps its PublishedItem records, which
 *        is what lets a second publish continue instead of duplicating.
 * WHERE: publishing.publish (router).
 */

import { TRPCError } from '@trpc/server'

import { JobKind } from '@/generated/prisma'
import type { DbClient } from '@/lib/config'
import type { PublicationOptions } from '@/lib/types'
import { createGenerationJob } from '@/lib/generation'
import * as courseService from '@/services/course.service'
import * as publishingService from '@/services/publishing.service'

export async function enqueuePublishCourse(
  db: DbClient,
  params: { organizationId: string; courseId: string; connectionId: string; createdById: string; options: PublicationOptions }
) {
  const connection = await publishingService.findConnectionWithCredentials(db, params.organizationId, params.connectionId)
  if (!connection) throw new TRPCError({ code: 'NOT_FOUND', message: 'That connection no longer exists.' })
  if (connection.platform !== params.options.platform) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'These options are for a different platform.' })
  }

  const course = await courseService.findCourseWithCurriculum(db, params.organizationId, params.courseId)
  if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
  const written = course.modules.flatMap((m) => m.lessons.filter((l) => l.kind === 'STANDARD' && l.currentVersionId !== null))
  if (written.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Write the lessons before publishing.' })

  const publication = await publishingService.upsertPublication(db, {
    organizationId: params.organizationId,
    courseId: course.id,
    connectionId: connection.id,
    platform: connection.platform,
    options: params.options,
    createdById: params.createdById,
  })
  const job = await createGenerationJob(db, {
    organizationId: params.organizationId,
    courseId: course.id,
    createdById: params.createdById,
    kind: JobKind.PUBLISH_COURSE,
    scope: null,
    tasks: [{ key: 'publish', agentId: 'coursePublisher', dependsOn: [], input: { courseId: course.id, publicationId: publication.id } }],
  })
  await publishingService.setPublicationJob(db, publication.id, job.id)
  return { jobId: job.id, publicationId: publication.id }
}
