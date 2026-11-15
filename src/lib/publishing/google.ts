import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: buildGoogleAuthUrl, exchangeGoogleCode,
 *   refreshGoogleToken, describeGoogleAccount, Google OAuth for publishing
 *
 * WHAT:  Google sign-in for publishing (YouTube, Google Classroom): the
 *        consent URL, the code exchange, token refresh, and naming the
 *        connected account (the YouTube channel, or the Google account).
 * WHY:   Uses the operator's Google app (publishingGoogleApp), so customers
 *        only click Connect and approve. `access_type=offline` +
 *        `prompt=consent` guarantee a refresh token, which publishing needs
 *        because uploads run later in the worker.
 * WHERE: src/lib/publishing/{connect,credentials}.ts.
 */

import { z } from 'zod'

import { PUBLISHING_PLATFORMS } from '@/lib/config'
import type { GoogleCredentials, GooglePublishingPlatform } from '@/lib/types'
import type { OAuthApp } from './apps'
import { publishingJson } from './http'
import { publishingRedirectUri } from './state'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'

export function buildGoogleAuthUrl(app: OAuthApp, platform: GooglePublishingPlatform, state: string): string {
  const params = new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: publishingRedirectUri(),
    response_type: 'code',
    scope: PUBLISHING_PLATFORMS[platform].scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `${AUTH_URL}?${params.toString()}`
}

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number(),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().optional(),
})

function tokenRequest(body: Record<string, string>) {
  return publishingJson(
    'Google',
    TOKEN_URL,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() },
    tokenResponseSchema
  )
}

export async function exchangeGoogleCode(app: OAuthApp, code: string): Promise<GoogleCredentials> {
  const body = await tokenRequest({
    code,
    client_id: app.clientId,
    client_secret: app.clientSecret,
    redirect_uri: publishingRedirectUri(),
    grant_type: 'authorization_code',
  })
  if (!body.refresh_token) {
    throw new Error('Google did not grant offline access. Remove the app from your Google account permissions and connect again.')
  }
  return {
    kind: 'google',
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + body.expires_in * 1000,
    scope: body.scope ?? '',
  }
}

export async function refreshGoogleToken(app: OAuthApp, credentials: GoogleCredentials): Promise<GoogleCredentials> {
  const body = await tokenRequest({
    client_id: app.clientId,
    client_secret: app.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type: 'refresh_token',
  })
  return {
    ...credentials,
    accessToken: body.access_token,
    expiresAt: Date.now() + body.expires_in * 1000,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
  }
}

const userInfoSchema = z.object({ sub: z.string(), email: z.string().optional(), name: z.string().optional() })
const channelListSchema = z.object({
  items: z.array(z.object({ id: z.string(), snippet: z.object({ title: z.string() }) })).optional(),
})

/** Display name and account id: the channel for YouTube, the Google account otherwise. */
export async function describeGoogleAccount(
  platform: GooglePublishingPlatform,
  accessToken: string
): Promise<{ name: string; accountId: string }> {
  if (platform === 'YOUTUBE') {
    const channels = await publishingJson(
      'YouTube',
      'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true',
      { token: accessToken },
      channelListSchema
    )
    const channel = channels.items?.[0]
    if (!channel) {
      throw new Error('This Google account has no YouTube channel yet. Create one on YouTube, then connect again.')
    }
    return { name: channel.snippet.title, accountId: channel.id }
  }
  const user = await publishingJson('Google', USERINFO_URL, { token: accessToken }, userInfoSchema)
  return { name: user.email ?? user.name ?? 'Google account', accountId: user.sub }
}
