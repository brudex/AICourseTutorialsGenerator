import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: buildCanvasAuthUrl, exchangeCanvasCode,
 *   refreshCanvasToken, sign in with Canvas, Canvas developer key OAuth
 *
 * WHAT:  "Sign in with Canvas" for schools whose Canvas site has a developer
 *        key registered by the operator: the authorize URL, the code exchange
 *        and token refresh (Canvas tokens last about an hour).
 * WHY:   Teachers connect with their Canvas login instead of creating and
 *        pasting an access token.
 * WHERE: src/lib/publishing/{connect,credentials}.ts.
 */

import { z } from 'zod'

import type { CanvasOAuthCredentials } from '@/lib/types'
import type { OAuthApp } from './apps'
import { publishingJson } from './http'
import { publishingRedirectUri } from './state'

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
  user: z.object({ id: z.union([z.number(), z.string()]).transform(String), name: z.string() }).optional(),
})

/* Canvas returns expires_in in seconds; one hour when it does not say. */
const DEFAULT_EXPIRY_SECONDS = 3_600

export function buildCanvasAuthUrl(app: OAuthApp, baseUrl: string, state: string): string {
  const params = new URLSearchParams({
    client_id: app.clientId,
    response_type: 'code',
    redirect_uri: publishingRedirectUri(),
    state,
  })
  return `${baseUrl}/login/oauth2/auth?${params.toString()}`
}

function tokenRequest(baseUrl: string, body: Record<string, string>) {
  return publishingJson(
    'Canvas',
    `${baseUrl}/login/oauth2/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() },
    tokenResponseSchema
  )
}

export async function exchangeCanvasCode(
  app: OAuthApp,
  baseUrl: string,
  code: string
): Promise<{ credentials: CanvasOAuthCredentials; user: { id: string; name: string } | null }> {
  const body = await tokenRequest(baseUrl, {
    grant_type: 'authorization_code',
    client_id: app.clientId,
    client_secret: app.clientSecret,
    redirect_uri: publishingRedirectUri(),
    code,
  })
  if (!body.refresh_token) throw new Error('Canvas did not grant lasting access. Try connecting again.')
  return {
    credentials: {
      kind: 'canvas-oauth',
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: Date.now() + (body.expires_in ?? DEFAULT_EXPIRY_SECONDS) * 1000,
    },
    user: body.user ?? null,
  }
}

export async function refreshCanvasToken(app: OAuthApp, baseUrl: string, credentials: CanvasOAuthCredentials): Promise<CanvasOAuthCredentials> {
  const body = await tokenRequest(baseUrl, {
    grant_type: 'refresh_token',
    client_id: app.clientId,
    client_secret: app.clientSecret,
    refresh_token: credentials.refreshToken,
  })
  return {
    ...credentials,
    accessToken: body.access_token,
    expiresAt: Date.now() + (body.expires_in ?? DEFAULT_EXPIRY_SECONDS) * 1000,
    ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
  }
}
