import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: publishingFetch, publishingJson, PublishingAuthError,
 *   platform HTTP errors, publishing API calls
 *
 * WHAT:  The one fetch wrapper publishers use to call outside platforms. It
 *        sets the bearer token, parses JSON and turns failures into plain
 *        messages a customer understands (PUBLISHING_ERROR_RULES).
 * WHY:   Failures a quick retry cannot fix (daily limits, expired access,
 *        missing permission) become AgentInputError: shown as is and not
 *        retried automatically. Temporary ones stay a normal Error so the
 *        task runner retries them. Either way the run resumes from
 *        PublishedItem, so nothing is uploaded twice.
 * WHERE: src/lib/publishing/{google,youtube,classroom,canvas}.ts.
 */

import { z } from 'zod'

import { AgentInputError } from '@/lib/generation/errors'

const REQUEST_TIMEOUT_MS = 120_000
/* Video uploads can be hundreds of MB on slow links. */
export const UPLOAD_TIMEOUT_MS = 30 * 60_000

/* The error shapes Google, Canvas, Vimeo and WordPress return. `reason` is
 * Google's machine-readable cause (uploadLimitExceeded, quotaExceeded, …). */
const reasonList = z.array(z.object({ message: z.string().optional(), reason: z.string().optional() }))
const errorBodySchema = z.object({
  error: z
    .union([z.string(), z.object({ message: z.string().optional(), status: z.string().optional(), errors: reasonList.optional() })])
    .optional(),
  errors: reasonList.optional(),
  message: z.string().optional(),
  developer_message: z.string().optional(),
  code: z.string().optional(),
})

function parseJsonText(text: string) {
  try {
    return errorBodySchema.safeParse(JSON.parse(text))
  } catch {
    return null
  }
}

interface Failure {
  platform: string
  status: number
  reason: string
  detail: string
}

/**
 * SOURCE OF TRUTH KEYWORDS: PUBLISHING_ERROR_RULES, friendly publishing
 *   errors, upload limit, quota exceeded, reconnect message, final errors
 *
 * The failures people actually hit, in plain words, and whether retrying
 * soon can help (`final: false`) or only a later Retry / a fix will
 * (`final: true`, which also stops the automatic retries). The first rule
 * that matches wins; anything else falls back to the platform's own words.
 */
const PUBLISHING_ERROR_RULES: ReadonlyArray<{ test: (f: Failure) => boolean; message: (f: Failure) => string; final: boolean }> = [
  {
    test: (f) => f.reason === 'uploadLimitExceeded' || /exceeded the number of videos/i.test(f.detail),
    message: (f) =>
      `${f.platform} has reached this channel’s daily upload limit. Everything uploaded so far is kept. Press Retry tomorrow to continue. Verifying the channel (youtube.com/verify) raises the limit.`,
    final: true,
  },
  {
    test: (f) => ['quotaExceeded', 'dailyLimitExceeded'].includes(f.reason) || /quota/i.test(f.detail),
    message: (f) => `Today’s ${f.platform} upload allowance is used up. Everything uploaded so far is kept. Press Retry tomorrow to continue.`,
    final: true,
  },
  {
    test: (f) => ['rateLimitExceeded', 'userRateLimitExceeded'].includes(f.reason) || f.status === 429,
    message: (f) => `${f.platform} asked us to slow down. Trying again shortly.`,
    final: false,
  },
  {
    test: (f) => f.reason === 'accessNotConfigured' || /has not been used in project|is disabled/i.test(f.detail),
    message: (f) => `Publishing to ${f.platform} is not switched on yet. Please contact support.`,
    final: true,
  },
  {
    test: (f) => ['youtubeSignupRequired', 'channelNotFound'].includes(f.reason),
    message: (f) => `This account has no ${f.platform} channel yet. Create one, then reconnect ${f.platform} in Settings → Connections.`,
    final: true,
  },
  {
    test: (f) => f.status === 401,
    message: (f) => `Your ${f.platform} connection has expired. Reconnect it in Settings → Connections, then press Retry.`,
    final: true,
  },
  {
    test: (f) => f.status === 403 || ['insufficientPermissions', 'forbidden'].includes(f.reason),
    message: (f) =>
      `${f.platform} did not allow this. Reconnect it in Settings → Connections and allow all the access it asks for, then press Retry.`,
    final: true,
  },
  {
    test: (f) => f.status === 413 || f.reason === 'uploadTooLarge',
    message: (f) => `A lecture video is too large for ${f.platform}. Shorter lectures or a smaller video size are needed.`,
    final: true,
  },
  {
    test: (f) => f.status >= 500,
    message: (f) => `${f.platform} had a temporary problem. Trying again shortly.`,
    final: false,
  },
]

async function describeFailure(platform: string, response: Response): Promise<{ message: string; final: boolean }> {
  const text = await response.text().catch(() => '')
  const parsed = parseJsonText(text)
  const body = parsed?.success ? parsed.data : null
  const nested = typeof body?.error === 'object' ? body.error : null
  const reason = nested?.errors?.[0]?.reason ?? body?.errors?.[0]?.reason ?? body?.code ?? ''
  const message =
    nested?.message ?? (typeof body?.error === 'string' ? body.error : undefined) ?? body?.errors?.[0]?.message ?? body?.developer_message ?? body?.message
  /* An HTML error page (a proxy, a retired site) says nothing useful past its title. */
  const htmlTitle = /<title>([^<]{1,120})<\/title>/i.exec(text)?.[1]?.trim()
  const looksLikeHtml = /^\s*</.test(text)
  const detail = (message ?? (looksLikeHtml ? (htmlTitle ?? response.statusText) : text.slice(0, 300))).trim()

  const failure: Failure = { platform, status: response.status, reason, detail }
  const rule = PUBLISHING_ERROR_RULES.find((candidate) => candidate.test(failure))
  if (rule) return { message: rule.message(failure), final: rule.final }
  return { message: `${platform} could not finish this step${detail ? `: ${detail.replace(/\.$/, '')}` : ''}.`, final: response.status < 500 }
}

export async function publishingFetch(
  platform: string,
  url: string,
  init: RequestInit & { token?: string; timeoutMs?: number }
): Promise<Response> {
  const { token, timeoutMs, headers, ...rest } = init
  let response: Response
  try {
    response = await fetch(url, {
      ...rest,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      signal: AbortSignal.timeout(timeoutMs ?? REQUEST_TIMEOUT_MS),
    })
  } catch {
    /* Network down or the request timed out: worth another try. */
    throw new Error(`Could not reach ${platform}. Trying again shortly.`)
  }
  /* With redirect: 'manual' the caller follows the redirect itself (Canvas
   * confirms uploads that way), so a 3xx is a success here. */
  const redirectHandled = rest.redirect === 'manual' && response.status >= 300 && response.status < 400
  if (response.ok || redirectHandled) return response
  const failure = await describeFailure(platform, response)
  /* Final failures stop the automatic retries; the rest are retried. */
  if (failure.final) throw new AgentInputError(failure.message)
  throw new Error(failure.message)
}

export async function publishingJson<T>(
  platform: string,
  url: string,
  init: RequestInit & { token?: string; timeoutMs?: number },
  schema: z.ZodType<T>
): Promise<T> {
  const response = await publishingFetch(platform, url, init)
  const parsed = schema.safeParse(await response.json())
  if (!parsed.success) throw new Error(`${platform} sent a reply this app did not expect.`)
  return parsed.data
}
