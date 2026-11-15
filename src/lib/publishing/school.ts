import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: schoolPublisher, verifySchoolConnection,
 *   publish to your online school, desktop to hosted school, course sync
 *   sender, SCHOOL_SYNC_STEPS
 *
 * WHAT:  Connecting this install to a school on a hosted install (its address
 *        and a school API key), and publishing a course there: send the
 *        course rows, upload each file the server is missing, then list the
 *        course in the school.
 * WHY:   Courses are made on the desktop app (offline friendly) while
 *        students learn on the hosted web app. The server reports which
 *        files it lacks, so a retry or a second publish only uploads what is
 *        new; rows keep their ids, so students keep their progress. Progress
 *        is reported in hundredths of the run (SCHOOL_SYNC_STEPS) because the
 *        file count is only known once the server has answered.
 * WHERE: src/lib/publishing/{connect,run}.ts; server side in
 *        src/app/api/v1/course-sync.
 */

import { PublishingPlatform } from '@/generated/prisma'
import { AgentInputError } from '@/lib/generation/errors'
import { courseSyncResultSchema, schoolListingResultSchema, schoolSyncInfoSchema, type Publisher } from '@/lib/types'
import { publishingFetch, publishingJson, UPLOAD_TIMEOUT_MS } from './http'

const PLATFORM = 'your online school'
export const SCHOOL_SYNC_STEPS = 100

/** Proves the address and key work; returns the school's name and address. */
export function verifySchoolConnection(baseUrl: string, apiKey: string) {
  return publishingJson(PLATFORM, `${baseUrl}/api/v1/school`, { token: apiKey }, schoolSyncInfoSchema)
}

export const schoolPublisher: Publisher<typeof PublishingPlatform.SCHOOL> = {
  platform: PublishingPlatform.SCHOOL,
  countItems: () => SCHOOL_SYNC_STEPS,

  async publish(ctx) {
    const base = ctx.connection.baseUrl
    if (!base) throw new AgentInputError('This connection has no school address. Disconnect it and connect again.')
    const token = await ctx.accessToken()
    const { snapshot, storageKeys } = await ctx.snapshot()
    ctx.log(`Sending "${snapshot.course.title}" (${snapshot.lessons.length} lectures) to ${base}`)

    const synced = await publishingJson(
      PLATFORM,
      `${base}/api/v1/course-sync`,
      { method: 'POST', token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot), timeoutMs: UPLOAD_TIMEOUT_MS },
      courseSyncResultSchema
    )
    /* 5% for the course itself, 90% spread over the files, 5% for listing. */
    await ctx.progress(5)
    ctx.log(`${synced.uploads.length} of ${snapshot.assets.length} files to upload`)

    for (const [index, assetId] of synced.uploads.entries()) {
      await ctx.assertLive()
      const key = storageKeys.get(assetId)
      if (!key) throw new AgentInputError('The school asked for a file this course does not have. Publish again.')
      const body = await ctx.read(key)
      await publishingFetch(PLATFORM, `${base}/api/v1/course-sync/${snapshot.course.id}/assets/${assetId}`, {
        method: 'PUT',
        token,
        headers: { 'Content-Type': 'application/octet-stream' },
        body: Buffer.from(body),
        timeoutMs: UPLOAD_TIMEOUT_MS,
      })
      await ctx.progress(5 + Math.floor(((index + 1) / synced.uploads.length) * 90))
    }

    const { listInSchool, openEnrollment } = ctx.options
    const listed = await publishingJson(
      PLATFORM,
      `${base}/api/v1/course-sync/${snapshot.course.id}/publish`,
      { method: 'POST', token, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ listed: listInSchool, openEnrollment }) },
      schoolListingResultSchema
    )
    await ctx.remember('course', snapshot.course.id, listed.url)
    await ctx.progress(SCHOOL_SYNC_STEPS)
    return { externalId: snapshot.course.id, externalUrl: listed.url }
  },
}
