import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: runPublication, PublishRunContext builder,
 *   publication run, decrypt publishing credentials, resumable publish
 *
 * WHAT:  Runs one publication in the worker: loads the publication and its
 *        connection, decrypts the credentials, builds the run context
 *        (fresh access tokens, file reads, remember/recall, progress, cancel
 *        checks) and hands it to the platform's publisher.
 * WHY:   Publishers only describe the platform's API; everything shared
 *        (credentials, storage, resumability, progress) is wired once here.
 *        Refreshed Google tokens are written back encrypted, so the next
 *        run does not refresh again.
 * WHERE: coursePublisher agent (src/lib/agents/course-publisher.ts).
 */

import { PublishingPlatform } from '@/generated/prisma'
import type { DbClient } from '@/lib/config'
import {
  publicationOptionsSchema,
  type PublicationOptions,
  type Publisher,
  type PublishResult,
  type PublishRunContext,
} from '@/lib/types'
import { AgentInputError } from '@/lib/generation/errors'
import { loadCoursePackageInput } from '@/lib/courses/package-input'
import { loadCourseSnapshot } from '@/lib/courses/course-snapshot'
import { getStorage } from '@/lib/storage'
import * as publishingService from '@/services/publishing.service'
import { connectionAccessToken } from './credentials'
import { canvasPublisher } from './canvas'
import { classroomPublisher } from './classroom'
import { drivePublisher } from './drive'
import { learndashPublisher } from './learndash'
import { vimeoPublisher } from './vimeo'
import { youtubePublisher } from './youtube'
import { schoolPublisher } from './school'

type SharedContext = Omit<PublishRunContext, 'options'>

/* Dispatch keeps each publisher paired with its own option shape. */
function publishWith(shared: SharedContext, options: PublicationOptions): Promise<PublishResult> {
  const run = <P extends PublishingPlatform>(publisher: Publisher<P>, typed: Extract<PublicationOptions, { platform: P }>) =>
    publisher.publish({ ...shared, options: typed })
  switch (options.platform) {
    case PublishingPlatform.YOUTUBE:
      return run(youtubePublisher, options)
    case PublishingPlatform.GOOGLE_CLASSROOM:
      return run(classroomPublisher, options)
    case PublishingPlatform.CANVAS:
      return run(canvasPublisher, options)
    case PublishingPlatform.VIMEO:
      return run(vimeoPublisher, options)
    case PublishingPlatform.GOOGLE_DRIVE:
      return run(drivePublisher, options)
    case PublishingPlatform.LEARNDASH:
      return run(learndashPublisher, options)
    case PublishingPlatform.SCHOOL:
      return run(schoolPublisher, options)
  }
}

function countItems(options: PublicationOptions, input: SharedContext['input']): number {
  switch (options.platform) {
    case PublishingPlatform.YOUTUBE:
      return youtubePublisher.countItems(input)
    case PublishingPlatform.GOOGLE_CLASSROOM:
      return classroomPublisher.countItems(input)
    case PublishingPlatform.CANVAS:
      return canvasPublisher.countItems(input)
    case PublishingPlatform.VIMEO:
      return vimeoPublisher.countItems(input)
    case PublishingPlatform.GOOGLE_DRIVE:
      return drivePublisher.countItems(input)
    case PublishingPlatform.LEARNDASH:
      return learndashPublisher.countItems(input)
    case PublishingPlatform.SCHOOL:
      return schoolPublisher.countItems(input)
  }
}

/* Adds how far the run got, keeping the error's kind (retry or not). */
function withProgress(error: unknown, done: number, total: number): Error {
  if (!(error instanceof Error) || done === 0) return error instanceof Error ? error : new Error('Publishing stopped.')
  const message = `${error.message} Progress so far: ${done} of ${total} steps.`
  return error instanceof AgentInputError ? new AgentInputError(message) : new Error(message)
}

export async function runPublication(
  db: DbClient,
  params: { publicationId: string; organizationId: string; assertLive: () => Promise<void>; log: (line: string) => void }
): Promise<PublishResult & { items: number }> {
  const publication = await publishingService.findPublicationForRun(db, params.publicationId)
  if (!publication || publication.organizationId !== params.organizationId) {
    throw new AgentInputError('This publication no longer exists.')
  }
  const options = publicationOptionsSchema.safeParse(publication.options)
  if (!options.success || options.data.platform !== publication.connection.platform) {
    throw new AgentInputError('The publish options are invalid. Publish the course again.')
  }

  const accessToken = connectionAccessToken(db, publication.connection)

  const input = await loadCoursePackageInput(db, publication.organizationId, publication.courseId)
  const storage = getStorage()
  const items = countItems(options.data, input)
  await publishingService.startPublicationRun(db, publication.id, items)
  let stepsDone = 0

  const shared: SharedContext = {
    input,
    connection: { id: publication.connection.id, name: publication.connection.name, baseUrl: publication.connection.baseUrl },
    accessToken,
    read: async (key) => {
      const object = await storage.get(key)
      if (!object) throw new AgentInputError(`A stored file is missing (${key.split('/').pop()}). Re-render it and publish again.`)
      return object.body
    },
    recall: (key) => publishingService.findPublishedItem(db, publication.id, key),
    remember: async (key, externalId, externalUrl = null) => {
      await publishingService.rememberPublishedItem(db, { publicationId: publication.id, key, externalId, externalUrl })
    },
    progress: async (done) => {
      stepsDone = Math.min(done, items)
      await publishingService.setPublicationProgress(db, publication.id, stepsDone)
    },
    assertLive: params.assertLive,
    snapshot: () => loadCourseSnapshot(db, publication.organizationId, publication.courseId),
    youtubeVideoFor: (lessonId) => publishingService.findYoutubeVideoId(db, publication.courseId, lessonId),
    log: params.log,
  }

  let result: PublishResult
  try {
    result = await publishWith(shared, options.data)
  } catch (error) {
    throw withProgress(error, stepsDone, items)
  }
  await publishingService.finishPublication(db, publication.id, result)
  return { ...result, items }
}
