import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: vimeoPublisher, buildVimeoAuthUrl,
 *   exchangeVimeoCode, Vimeo upload, tus upload, Vimeo showcase, Vimeo
 *   text tracks
 *
 * WHAT:  Vimeo sign-in (authorize URL, code exchange) and the publisher: a
 *        showcase for the course, each lecture video uploaded (tus) with the
 *        chosen privacy and added to the showcase, and its captions attached
 *        as a text track.
 * WHY:   Uses the operator's Vimeo app, so customers only sign in. Vimeo
 *        tokens do not expire, so no refresh. Every created item is
 *        remembered, so retries resume. Captions are best effort, like on
 *        YouTube: the video is the deliverable.
 * WHERE: src/lib/publishing/{connect,run}.ts.
 */

import { z } from 'zod'

import { PublishingPlatform } from '@/generated/prisma'
import { PUBLISHING_PLATFORMS, webLanguageCode } from '@/lib/config'
import type { Publisher, PublishRunContext, VimeoCredentials } from '@/lib/types'
import type { OAuthApp } from './apps'
import { publishingFetch, publishingJson, UPLOAD_TIMEOUT_MS } from './http'
import { publishingRedirectUri } from './state'

const API = 'https://api.vimeo.com'
const ACCEPT = { Accept: 'application/vnd.vimeo.*+json;version=3.4' }

// ── Sign-in ──────────────────────────────────────────────────────────────

export function buildVimeoAuthUrl(app: OAuthApp, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: app.clientId,
    redirect_uri: publishingRedirectUri(),
    state,
    scope: PUBLISHING_PLATFORMS.VIMEO.scopes.join(' '),
  })
  return `${API}/oauth/authorize?${params.toString()}`
}

const tokenSchema = z.object({
  access_token: z.string().min(1),
  user: z.object({ name: z.string(), uri: z.string() }),
})

export async function exchangeVimeoCode(
  app: OAuthApp,
  code: string
): Promise<{ credentials: VimeoCredentials; account: { name: string; accountId: string } }> {
  const body = await publishingJson(
    'Vimeo',
    `${API}/oauth/access_token`,
    {
      method: 'POST',
      headers: {
        ...ACCEPT,
        'Content-Type': 'application/json',
        Authorization: `basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString('base64')}`,
      },
      body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: publishingRedirectUri() }),
    },
    tokenSchema
  )
  return {
    credentials: { kind: 'vimeo', accessToken: body.access_token },
    account: { name: body.user.name, accountId: body.user.uri.split('/').pop() ?? body.user.uri },
  }
}

// ── Publisher ────────────────────────────────────────────────────────────

const albumSchema = z.object({ uri: z.string(), link: z.string() })
const videoSchema = z.object({ uri: z.string(), link: z.string(), upload: z.object({ upload_link: z.string() }) })
const trackSchema = z.object({ uri: z.string(), link: z.string() })

const idOf = (uri: string) => uri.split('/').pop() ?? uri

async function vimeoJson<T>(context: PublishRunContext<'VIMEO'>, path: string, method: string, body: object, schema: z.ZodType<T>) {
  return publishingJson(
    'Vimeo',
    `${API}${path}`,
    { method, token: await context.accessToken(), headers: { ...ACCEPT, 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    schema
  )
}

function lecturesWithVideo(input: PublishRunContext['input']) {
  return input.lectures.filter((lecture) => lecture.video !== null)
}

async function attachCaptions(context: PublishRunContext<'VIMEO'>, videoId: string, vtt: Uint8Array) {
  const language = webLanguageCode(context.input.course.language)
  if (!language) throw new Error(`no language code for "${context.input.course.language}"`)
  const track = await vimeoJson(context, `/videos/${videoId}/texttracks`, 'POST', { type: 'captions', language, name: 'Captions' }, trackSchema)
  await publishingFetch('Vimeo', track.link, { method: 'PUT', headers: { 'Content-Type': 'text/vtt' }, body: Buffer.from(vtt) })
  await publishingFetch('Vimeo', `${API}${track.uri}`, {
    method: 'PATCH',
    token: await context.accessToken(),
    headers: { ...ACCEPT, 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: true }),
  })
  return idOf(track.uri)
}

export const vimeoPublisher: Publisher<'VIMEO'> = {
  platform: PublishingPlatform.VIMEO,
  countItems: (input) => 1 + lecturesWithVideo(input).length,

  async publish(context) {
    const lectures = lecturesWithVideo(context.input)
    if (lectures.length === 0) throw new Error('No lecture has a rendered video yet. Render the videos, then publish.')
    const { course } = context.input

    let album = await context.recall('course:showcase')
    if (!album) {
      const created = await vimeoJson(
        context,
        '/me/albums',
        'POST',
        {
          name: course.title.slice(0, 128),
          description: (course.subtitle ?? course.description ?? '').slice(0, 4_000),
          privacy: context.options.privacy === 'nobody' ? 'nobody' : context.options.privacy === 'unlisted' ? 'unlisted' : 'anybody',
        },
        albumSchema
      )
      await context.remember('course:showcase', idOf(created.uri), created.link)
      album = { externalId: idOf(created.uri), externalUrl: created.link }
    }
    let done = 1
    await context.progress(done)

    for (const lecture of lectures) {
      await context.assertLive()
      const videoKey = `lecture:${lecture.lessonId}:video`
      let videoId = (await context.recall(videoKey))?.externalId ?? null
      if (!videoId && lecture.video) {
        context.log(`uploading "${lecture.title}" to Vimeo`)
        const body = await context.read(lecture.video.storageKey)
        const created = await vimeoJson(
          context,
          '/me/videos',
          'POST',
          {
            upload: { approach: 'tus', size: body.byteLength },
            name: lecture.title.slice(0, 128),
            description: (lecture.content?.objectives ?? []).map((o) => `• ${o}`).join('\n').slice(0, 5_000),
            privacy: { view: context.options.privacy },
          },
          videoSchema
        )
        await publishingFetch('Vimeo', created.upload.upload_link, {
          method: 'PATCH',
          headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': '0', 'Content-Type': 'application/offset+octet-stream' },
          body: Buffer.from(body),
          timeoutMs: UPLOAD_TIMEOUT_MS,
        })
        videoId = idOf(created.uri)
        await context.remember(videoKey, videoId, created.link)
      }
      if (!videoId) continue

      const showcaseKey = `lecture:${lecture.lessonId}:showcase`
      if (!(await context.recall(showcaseKey))) {
        await publishingFetch('Vimeo', `${API}/me/albums/${album.externalId}/videos/${videoId}`, {
          method: 'PUT',
          token: await context.accessToken(),
          headers: ACCEPT,
        })
        await context.remember(showcaseKey, videoId)
      }

      const captionsKey = `lecture:${lecture.lessonId}:captions`
      if (lecture.captionsKey && !(await context.recall(captionsKey))) {
        try {
          await context.remember(captionsKey, await attachCaptions(context, videoId, await context.read(lecture.captionsKey)))
        } catch (error) {
          context.log(`captions skipped for "${lecture.title}": ${error instanceof Error ? error.message : 'upload refused'}`)
        }
      }
      done += 1
      await context.progress(done)
    }

    return { externalId: album.externalId, externalUrl: album.externalUrl ?? `https://vimeo.com/showcase/${album.externalId}` }
  },
}
