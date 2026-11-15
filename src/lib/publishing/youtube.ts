import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: youtubePublisher, YouTube upload, resumable
 *   upload, videos.insert, playlists.insert, playlistItems.insert,
 *   captions.insert, course playlist
 *
 * WHAT:  Publishes a course to a YouTube channel: one playlist for the course,
 *        then for each lecture with a rendered video: upload (resumable), add
 *        to the playlist in order, and attach its captions.
 * WHY:   Every created thing is remembered (PublishedItem) before moving on,
 *        so a retry after a network failure or quota stop continues where it
 *        left off instead of uploading the same video twice. Videos go in the
 *        Education category with the privacy the user chose. Captions are
 *        best effort: a caption refusal is logged and the video still counts,
 *        because the video is the deliverable.
 * WHERE: Registered in PUBLISHERS (src/lib/publishing/index.ts).
 */

import { z } from 'zod'

import { PublishingPlatform } from '@/generated/prisma'
import { webLanguageCode } from '@/lib/config'
import type { Publisher, PublishRunContext } from '@/lib/types'
import { publishingFetch, publishingJson, UPLOAD_TIMEOUT_MS } from './http'

const API = 'https://www.googleapis.com/youtube/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3'
const EDUCATION_CATEGORY_ID = '27'
const idSchema = z.object({ id: z.string().min(1) })

/* YouTube rejects the whole request for a language it cannot parse
 * ("Playlist localization validation failed"), so only send real codes. */
function languageFields(input: PublishRunContext['input']): { defaultLanguage?: string } {
  const code = webLanguageCode(input.course.language)
  return code ? { defaultLanguage: code } : {}
}

/* YouTube rejects titles over 100 characters and angle brackets. */
function youtubeTitle(text: string): string {
  return text.replace(/[<>]/g, '').slice(0, 100).trim()
}

function youtubeDescription(lines: readonly string[]): string {
  return lines.join('\n').replace(/[<>]/g, '').slice(0, 4_900)
}

function lecturesWithVideo(input: PublishRunContext['input']) {
  return input.lectures.filter((lecture) => lecture.video !== null)
}

async function ensurePlaylist(context: PublishRunContext<'YOUTUBE'>, token: string): Promise<string> {
  const remembered = await context.recall('course:playlist')
  if (remembered) return remembered.externalId
  const { course } = context.input
  const playlist = await publishingJson(
    'YouTube',
    `${API}/playlists?part=snippet,status`,
    {
      method: 'POST',
      token,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snippet: {
          title: youtubeTitle(course.title),
          description: youtubeDescription([course.subtitle ?? '', '', course.description ?? course.goal ?? '']),
          ...languageFields(context.input),
        },
        status: { privacyStatus: context.options.privacy },
      }),
    },
    idSchema
  )
  const url = `https://www.youtube.com/playlist?list=${playlist.id}`
  await context.remember('course:playlist', playlist.id, url)
  return playlist.id
}

async function uploadVideo(
  context: PublishRunContext<'YOUTUBE'>,
  token: string,
  body: Uint8Array,
  metadata: { title: string; description: string }
): Promise<string> {
  /* Step 1: open a resumable session; YouTube answers with its upload URL. */
  const session = await publishingFetch('YouTube', `${UPLOAD_API}/videos?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    token,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(body.byteLength),
      'X-Upload-Content-Type': 'video/mp4',
    },
    body: JSON.stringify({
      snippet: {
        title: metadata.title,
        description: metadata.description,
        categoryId: EDUCATION_CATEGORY_ID,
        ...languageFields(context.input),
      },
      status: { privacyStatus: context.options.privacy, selfDeclaredMadeForKids: context.options.madeForKids },
    }),
  })
  const uploadUrl = session.headers.get('location')
  if (!uploadUrl) throw new Error('YouTube did not return an upload address.')

  /* Step 2: send the file. */
  const video = await publishingJson(
    'YouTube',
    uploadUrl,
    { method: 'PUT', token, headers: { 'Content-Type': 'video/mp4' }, body: Buffer.from(body), timeoutMs: UPLOAD_TIMEOUT_MS },
    idSchema
  )
  return video.id
}

async function uploadCaptions(context: PublishRunContext<'YOUTUBE'>, token: string, videoId: string, vtt: Uint8Array) {
  const boundary = `caption-${videoId}`
  /* Captions must carry a real language; an unknown one is skipped (logged by the caller). */
  const language = webLanguageCode(context.input.course.language)
  if (!language) throw new Error(`no language code for "${context.input.course.language}"`)
  const metadata = JSON.stringify({ snippet: { videoId, language, name: 'Captions', isDraft: false } })
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: text/vtt\r\n\r\n`),
    Buffer.from(vtt),
    Buffer.from(`\r\n--${boundary}--`),
  ])
  return publishingJson(
    'YouTube',
    `${UPLOAD_API}/captions?part=snippet&uploadType=multipart`,
    { method: 'POST', token, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body },
    idSchema
  )
}

export const youtubePublisher: Publisher<'YOUTUBE'> = {
  platform: PublishingPlatform.YOUTUBE,
  /* Playlist + (upload, playlist entry) per lecture. */
  countItems: (input) => 1 + lecturesWithVideo(input).length,

  async publish(context) {
    const lectures = lecturesWithVideo(context.input)
    if (lectures.length === 0) {
      throw new Error('No lecture has a rendered video yet. Render the videos, then publish.')
    }
    const moduleTitle = new Map(context.input.modules.map((m) => [m.id, m.title]))

    const playlistId = await ensurePlaylist(context, await context.accessToken())
    let done = 1
    await context.progress(done)

    for (const [index, lecture] of lectures.entries()) {
      await context.assertLive()
      const videoKey = `lecture:${lecture.lessonId}:video`
      let videoId = (await context.recall(videoKey))?.externalId ?? null

      if (!videoId && lecture.video) {
        context.log(`uploading "${lecture.title}"`)
        const description = youtubeDescription([
          `${context.input.course.title} · ${moduleTitle.get(lecture.moduleId) ?? ''}`,
          '',
          ...(lecture.content ? ['In this lecture:', ...lecture.content.objectives.map((o) => `• ${o}`)] : []),
        ])
        videoId = await uploadVideo(context, await context.accessToken(), await context.read(lecture.video.storageKey), {
          title: youtubeTitle(lecture.title),
          description,
        })
        await context.remember(videoKey, videoId, `https://www.youtube.com/watch?v=${videoId}`)
      }
      if (!videoId) continue

      const entryKey = `lecture:${lecture.lessonId}:playlist`
      if (!(await context.recall(entryKey))) {
        const entry = await publishingJson(
          'YouTube',
          `${API}/playlistItems?part=snippet`,
          {
            method: 'POST',
            token: await context.accessToken(),
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              snippet: { playlistId, position: index, resourceId: { kind: 'youtube#video', videoId } },
            }),
          },
          idSchema
        )
        await context.remember(entryKey, entry.id)
      }

      const captionsKey = `lecture:${lecture.lessonId}:captions`
      if (lecture.captionsKey && !(await context.recall(captionsKey))) {
        try {
          const caption = await uploadCaptions(context, await context.accessToken(), videoId, await context.read(lecture.captionsKey))
          await context.remember(captionsKey, caption.id)
        } catch (error) {
          context.log(`captions skipped for "${lecture.title}": ${error instanceof Error ? error.message : 'upload refused'}`)
        }
      }

      done += 1
      await context.progress(done)
    }

    return { externalId: playlistId, externalUrl: `https://www.youtube.com/playlist?list=${playlistId}` }
  },
}
