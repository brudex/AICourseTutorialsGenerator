import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: learndashPublisher, LearnDash publish, WordPress
 *   application password, authorize-application, verifyWordPressSite,
 *   buildWordPressAuthorizeUrl, wordpressAuthHeader, sfwd-courses,
 *   sfwd-lessons, sfwd-topic, WordPress media upload
 *
 * WHAT:  Connecting a WordPress site that runs LearnDash, and publishing to
 *        it: a LearnDash course, a lesson per section and a topic per
 *        lecture holding the video (uploaded to the media library) and the
 *        notes.
 * WHY:   WordPress has a built-in approval page (authorize-application.php):
 *        the site owner approves and WordPress hands back an application
 *        password, so no developer keys are needed. WordPress only redirects
 *        back to https addresses, so http installs (local, desktop) show the
 *        password on screen for the user to paste instead. LearnDash's REST
 *        API (ldlms/v2) must be enabled in LearnDash's settings; the connect
 *        check says so when it is not. Items are remembered so retries
 *        resume.
 * WHERE: src/lib/publishing/{connect,run}.ts and the publishing router.
 */

import { z } from 'zod'

import { PublishingPlatform } from '@/generated/prisma'
import { appName } from '@/lib/config'
import type { Publisher, PublishRunContext } from '@/lib/types'
import { lessonBodyHtml } from '@/lib/render/documents'
import { publishingJson, UPLOAD_TIMEOUT_MS } from './http'

/* Fixed id so WordPress groups this app's passwords under one name. */
const WORDPRESS_APP_ID = '0b5f6f6e-3c55-4b4e-9a62-7f2a4c1d8e31'

export function wordpressAuthHeader(credential: string) {
  return { Authorization: `Basic ${Buffer.from(credential).toString('base64')}` }
}

/** WordPress's approval page; with a success URL it sends the password back. */
export function buildWordPressAuthorizeUrl(baseUrl: string, successUrl: string | null, rejectUrl: string | null): string {
  const params = new URLSearchParams({ app_name: appName(), app_id: WORDPRESS_APP_ID })
  if (successUrl) params.set('success_url', successUrl)
  if (rejectUrl) params.set('reject_url', rejectUrl)
  return `${baseUrl}/wp-admin/authorize-application.php?${params.toString()}`
}

const meSchema = z.object({ id: z.union([z.number(), z.string()]).transform(String), name: z.string() })

/** Proves the password works and LearnDash's REST API is on; returns the user. */
export async function verifyWordPressSite(baseUrl: string, username: string, appPassword: string) {
  const headers = wordpressAuthHeader(`${username}:${appPassword}`)
  const user = await publishingJson('WordPress', `${baseUrl}/wp-json/wp/v2/users/me?context=edit`, { headers }, meSchema)
  const learndash = await fetch(`${baseUrl}/wp-json/ldlms/v2/sfwd-courses?per_page=1`, { headers, signal: AbortSignal.timeout(30_000) })
  if (!learndash.ok) {
    throw new Error('LearnDash’s REST API is not on for this site. In WordPress, open LearnDash LMS → Settings → Advanced → REST API and turn it on.')
  }
  return user
}

// ── Publisher ────────────────────────────────────────────────────────────

const postSchema = z.object({ id: z.union([z.number(), z.string()]).transform(String), link: z.string().optional() })
const mediaSchema = z.object({ id: z.union([z.number(), z.string()]).transform(String), source_url: z.string() })

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

async function wpPost<T>(context: PublishRunContext<'LEARNDASH'>, path: string, body: object, schema: z.ZodType<T>) {
  return publishingJson(
    'WordPress',
    `${context.connection.baseUrl}/wp-json${path}`,
    { method: 'POST', headers: { ...wordpressAuthHeader(await context.accessToken()), 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    schema
  )
}

async function uploadMedia(context: PublishRunContext<'LEARNDASH'>, fileName: string, contentType: string, body: Uint8Array) {
  return publishingJson(
    'WordPress',
    `${context.connection.baseUrl}/wp-json/wp/v2/media`,
    {
      method: 'POST',
      headers: {
        ...wordpressAuthHeader(await context.accessToken()),
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName.replace(/[^\w.-]+/g, '-')}"`,
      },
      body: Buffer.from(body),
      timeoutMs: UPLOAD_TIMEOUT_MS,
    },
    mediaSchema
  )
}

function sectionsWithLectures(input: PublishRunContext['input']) {
  return input.modules
    .map((mod) => ({ mod, lectures: input.lectures.filter((l) => l.moduleId === mod.id && l.content !== null) }))
    .filter((section) => section.lectures.length > 0)
}

export const learndashPublisher: Publisher<'LEARNDASH'> = {
  platform: PublishingPlatform.LEARNDASH,
  countItems: (input) => 1 + sectionsWithLectures(input).reduce((total, s) => total + 1 + s.lectures.length, 0),

  async publish(context) {
    if (!context.connection.baseUrl) throw new Error('This WordPress connection has no site address.')
    const sections = sectionsWithLectures(context.input)
    if (sections.length === 0) throw new Error('No lecture has been written yet, so there is nothing to publish.')
    const status = context.options.status
    const { course } = context.input

    let ldCourse = await context.recall('course:learndash')
    if (!ldCourse) {
      const created = await wpPost(
        context,
        '/ldlms/v2/sfwd-courses',
        { title: course.title, content: `<p>${escapeHtml(course.description ?? course.subtitle ?? '')}</p>`, status },
        postSchema
      )
      await context.remember('course:learndash', created.id, created.link ?? null)
      ldCourse = { externalId: created.id, externalUrl: created.link ?? null }
    }
    let done = 1
    await context.progress(done)

    for (const [sectionIndex, section] of sections.entries()) {
      await context.assertLive()
      const lessonKey = `module:${section.mod.id}:lesson`
      let lessonId = (await context.recall(lessonKey))?.externalId ?? null
      if (!lessonId) {
        const lesson = await wpPost(
          context,
          '/ldlms/v2/sfwd-lessons',
          { title: section.mod.title, status, course: Number(ldCourse.externalId), menu_order: sectionIndex + 1 },
          postSchema
        )
        lessonId = lesson.id
        await context.remember(lessonKey, lessonId, lesson.link ?? null)
      }
      done += 1
      await context.progress(done)

      for (const [lectureIndex, lecture] of section.lectures.entries()) {
        await context.assertLive()
        const topicKey = `lecture:${lecture.lessonId}:topic`
        if (!(await context.recall(topicKey))) {
          let videoHtml = ''
          if (lecture.video) {
            const mediaKey = `lecture:${lecture.lessonId}:media`
            let media = await context.recall(mediaKey)
            if (!media) {
              context.log(`uploading "${lecture.title}" to WordPress`)
              const uploaded = await uploadMedia(context, `${lecture.title}.mp4`, 'video/mp4', await context.read(lecture.video.storageKey))
              await context.remember(mediaKey, uploaded.id, uploaded.source_url)
              media = { externalId: uploaded.id, externalUrl: uploaded.source_url }
            }
            if (media.externalUrl) videoHtml = `[video src="${media.externalUrl}"]\n\n`
          }
          const notes = lecture.content ? await lessonBodyHtml(lecture.content) : ''
          const topic = await wpPost(
            context,
            '/ldlms/v2/sfwd-topic',
            {
              title: lecture.title,
              content: videoHtml + notes,
              status,
              course: Number(ldCourse.externalId),
              lesson: Number(lessonId),
              menu_order: lectureIndex + 1,
            },
            postSchema
          )
          await context.remember(topicKey, topic.id, topic.link ?? null)
        }
        done += 1
        await context.progress(done)
      }
    }

    return {
      externalId: ldCourse.externalId,
      externalUrl: ldCourse.externalUrl ?? `${context.connection.baseUrl}/?p=${ldCourse.externalId}`,
    }
  },
}
