import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: readConnectionCredentials, connectionAccessToken,
 *   token refresh, decrypt connection credentials, persist refreshed token
 *
 * WHAT:  Turns a connection's stored (encrypted) credentials into a usable
 *        access token (or WordPress `user:password` for Basic auth), refreshing Google and Canvas sign-in tokens when they
 *        are close to expiry and saving the refreshed ones back, encrypted.
 * WHY:   The worker (publishing) and the router (listing Canvas courses) both
 *        need a working token; one function keeps the refresh rules and the
 *        error messages identical in both.
 * WHERE: src/lib/publishing/run.ts, publishing.canvasCourses.
 */

import type { DbClient } from '@/lib/config'
import { publishingCredentialsSchema, type PublishingCredentials } from '@/lib/types'
import { decryptApiKey, encryptApiKey } from '@/lib/ai'
import { AgentInputError } from '@/lib/generation/errors'
import * as publishingService from '@/services/publishing.service'
import { publishingCanvasApp, publishingGoogleApp } from './apps'
import { refreshCanvasToken } from './canvas-oauth'
import { refreshGoogleToken } from './google'

/* Refresh a little early so a long upload never starts with a dying token. */
const REFRESH_MARGIN_MS = 5 * 60_000

export function readConnectionCredentials(ciphertext: string): PublishingCredentials {
  const parsed = publishingCredentialsSchema.safeParse(JSON.parse(decryptApiKey(ciphertext)))
  if (!parsed.success) throw new AgentInputError('This connection can no longer be read. Disconnect it and connect again.')
  return parsed.data
}

/**
 * A working access token for a connection. Returns a function so long runs
 * can ask again between uploads and get a refreshed token when needed.
 */
export function connectionAccessToken(
  db: DbClient,
  connection: { id: string; baseUrl: string | null; credentialsCiphertext: string }
): () => Promise<string> {
  let credentials = readConnectionCredentials(connection.credentialsCiphertext)

  const save = async (next: PublishingCredentials) => {
    credentials = next
    await publishingService.updateConnectionCredentials(db, connection.id, encryptApiKey(JSON.stringify(next)))
  }

  return async () => {
    if (credentials.kind === 'canvas') return credentials.token
    /* Vimeo tokens do not expire. */
    if (credentials.kind === 'vimeo') return credentials.accessToken
    /* WordPress: `user:applicationPassword` for Basic auth (see wordpressAuthHeader). */
    if (credentials.kind === 'wordpress') return `${credentials.username}:${credentials.appPassword}`
    /* Your online school: a school API key, sent as a Bearer token. */
    if (credentials.kind === 'school') return credentials.apiKey
    if (credentials.expiresAt - REFRESH_MARGIN_MS > Date.now()) return credentials.accessToken

    if (credentials.kind === 'google') {
      const app = publishingGoogleApp()
      if (!app) throw new AgentInputError('Publishing to Google is not available right now. Please contact support.')
      const next = await refreshGoogleToken(app, credentials)
      await save(next)
      return next.accessToken
    }

    const app = connection.baseUrl ? publishingCanvasApp(connection.baseUrl) : null
    if (!app || !connection.baseUrl) {
      throw new AgentInputError('Sign in with Canvas is no longer available for this school. Disconnect and connect again.')
    }
    const next = await refreshCanvasToken(app, connection.baseUrl, credentials)
    await save(next)
    return next.accessToken
  }
}
