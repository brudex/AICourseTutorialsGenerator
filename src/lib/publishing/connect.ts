import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: buildConnectUrl, completeConnection, one-click
 *   connect, sign in to connect, Google connect, Canvas connect
 *
 * WHAT:  Starts and finishes a sign-in connection for any platform: the URL
 *        the browser goes to (Google or Vimeo consent, the school's Canvas
 *        login, or the WordPress approval page),
 *        and, once the platform sends the user back, the code exchange,
 *        naming the account and saving the connection with its credentials
 *        encrypted.
 * WHY:   Customers only click Connect: the OAuth apps belong to the operator
 *        (src/lib/publishing/apps.ts). For Canvas, a school without a
 *        registered developer key returns no URL, and the UI offers the
 *        access-token fallback instead.
 * WHERE: publishing router (connectUrl, completeConnect).
 */

import { PublishingPlatform } from '@/generated/prisma'
import { APP_URL, type DbClient } from '@/lib/config'
import { GOOGLE_PUBLISHING_PLATFORMS, type GooglePublishingPlatform } from '@/lib/types'
import { encryptApiKey } from '@/lib/ai'
import * as publishingService from '@/services/publishing.service'
import { publishingCanvasApp, publishingGoogleApp, publishingVimeoApp } from './apps'
import { verifyCanvasToken } from './canvas'
import { buildCanvasAuthUrl, exchangeCanvasCode } from './canvas-oauth'
import { buildGoogleAuthUrl, describeGoogleAccount, exchangeGoogleCode } from './google'
import { buildWordPressAuthorizeUrl, verifyWordPressSite } from './learndash'
import { verifySchoolConnection } from './school'
import { publishingRedirectUri, signConnectState } from './state'
import { buildVimeoAuthUrl, exchangeVimeoCode } from './vimeo'

export class ConnectUnavailableError extends Error {}

export function isGooglePlatform(platform: PublishingPlatform): platform is GooglePublishingPlatform {
  return GOOGLE_PUBLISHING_PLATFORMS.some((p) => p === platform)
}

/** Which platforms can be connected by signing in right now. */
export function signInAvailability() {
  return { google: publishingGoogleApp() !== null, vimeo: publishingVimeoApp() !== null }
}

/* WordPress only sends the password back to https addresses. */
const wordpressCanRedirect = () => APP_URL.startsWith('https://')

/**
 * The sign-in URL, or null when the customer must finish by hand: a Canvas
 * school without a developer key, or WordPress when this app is on http.
 */
export function buildConnectUrl(params: {
  organizationId: string
  userId: string
  platform: PublishingPlatform
  baseUrl: string | null
}): string | null {
  const state = signConnectState(params)
  if (isGooglePlatform(params.platform)) {
    const app = publishingGoogleApp()
    if (!app) throw new ConnectUnavailableError('Connecting to Google is not available yet. Please try again later.')
    return buildGoogleAuthUrl(app, params.platform, state)
  }
  if (params.platform === PublishingPlatform.VIMEO) {
    const app = publishingVimeoApp()
    if (!app) throw new ConnectUnavailableError('Connecting to Vimeo is not available yet. Please try again later.')
    return buildVimeoAuthUrl(app, state)
  }
  if (!params.baseUrl) throw new ConnectUnavailableError('Enter the site address first.')
  if (params.platform === PublishingPlatform.LEARNDASH) {
    if (!wordpressCanRedirect()) return null
    const back = new URL(publishingRedirectUri())
    back.searchParams.set('state', state)
    const rejected = new URL(back)
    rejected.searchParams.set('error', 'access_denied')
    return buildWordPressAuthorizeUrl(params.baseUrl, back.toString(), rejected.toString())
  }
  const app = publishingCanvasApp(params.baseUrl)
  return app ? buildCanvasAuthUrl(app, params.baseUrl, state) : null
}

/** Verifies a WordPress application password and saves the LearnDash connection. */
export async function saveWordPressConnection(
  db: DbClient,
  params: { organizationId: string; userId: string; baseUrl: string; username: string; appPassword: string }
) {
  const user = await verifyWordPressSite(params.baseUrl, params.username, params.appPassword)
  return publishingService.saveConnection(db, {
    organizationId: params.organizationId,
    platform: PublishingPlatform.LEARNDASH,
    name: `${new URL(params.baseUrl).host} (${user.name})`,
    accountId: user.id,
    baseUrl: params.baseUrl,
    credentialsCiphertext: encryptApiKey(JSON.stringify({ kind: 'wordpress', username: params.username, appPassword: params.appPassword })),
    createdById: params.userId,
  })
}

/** Verifies a school API key on a hosted install and saves "Your online school". */
export async function saveSchoolConnection(
  db: DbClient,
  params: { organizationId: string; userId: string; baseUrl: string; apiKey: string }
) {
  const school = await verifySchoolConnection(params.baseUrl, params.apiKey)
  return publishingService.saveConnection(db, {
    organizationId: params.organizationId,
    platform: PublishingPlatform.SCHOOL,
    name: `${school.name} (${new URL(params.baseUrl).host})`,
    accountId: new URL(school.url).host,
    baseUrl: params.baseUrl,
    credentialsCiphertext: encryptApiKey(JSON.stringify({ kind: 'school', apiKey: params.apiKey })),
    createdById: params.userId,
  })
}

export async function completeConnection(
  db: DbClient,
  params: {
    organizationId: string
    userId: string
    platform: PublishingPlatform
    baseUrl: string | null
    code: string | null
    wordpress: { username: string; appPassword: string } | null
  }
) {
  if (params.platform === PublishingPlatform.LEARNDASH) {
    if (!params.baseUrl || !params.wordpress) throw new ConnectUnavailableError('WordPress did not send the approval back. Please try again.')
    return saveWordPressConnection(db, { ...params, baseUrl: params.baseUrl, ...params.wordpress })
  }
  if (!params.code) throw new ConnectUnavailableError('The sign-in did not finish. Please try again.')
  const code = params.code

  if (params.platform === PublishingPlatform.VIMEO) {
    const app = publishingVimeoApp()
    if (!app) throw new ConnectUnavailableError('Connecting to Vimeo is not available yet.')
    const { credentials, account } = await exchangeVimeoCode(app, code)
    return publishingService.saveConnection(db, {
      organizationId: params.organizationId,
      platform: PublishingPlatform.VIMEO,
      name: account.name,
      accountId: account.accountId,
      baseUrl: null,
      credentialsCiphertext: encryptApiKey(JSON.stringify(credentials)),
      createdById: params.userId,
    })
  }

  if (isGooglePlatform(params.platform)) {
    const app = publishingGoogleApp()
    if (!app) throw new ConnectUnavailableError('Connecting to Google is not available yet.')
    const credentials = await exchangeGoogleCode(app, code)
    const account = await describeGoogleAccount(params.platform, credentials.accessToken)
    return publishingService.saveConnection(db, {
      organizationId: params.organizationId,
      platform: params.platform,
      name: account.name,
      accountId: account.accountId,
      baseUrl: null,
      credentialsCiphertext: encryptApiKey(JSON.stringify(credentials)),
      createdById: params.userId,
    })
  }

  const app = params.baseUrl ? publishingCanvasApp(params.baseUrl) : null
  if (!app || !params.baseUrl) throw new ConnectUnavailableError('Sign in with Canvas is not available for this school.')
  const { credentials, user } = await exchangeCanvasCode(app, params.baseUrl, code)
  const account = user ?? (await verifyCanvasToken(params.baseUrl, credentials.accessToken))
  return publishingService.saveConnection(db, {
    organizationId: params.organizationId,
    platform: PublishingPlatform.CANVAS,
    name: `${new URL(params.baseUrl).host} (${account.name})`,
    accountId: account.id,
    baseUrl: params.baseUrl,
    credentialsCiphertext: encryptApiKey(JSON.stringify(credentials)),
    createdById: params.userId,
  })
}
