import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: signConnectState, readConnectState,
 *   publishingRedirectUri, OAuth state, signed state, connect callback
 *
 * WHAT:  The signed, expiring `state` carried through an OAuth sign-in
 *        (Google or Canvas), and the redirect address the platforms send the
 *        browser back to.
 * WHY:   HMAC-signed with the auth secret so the callback can trust which
 *        workspace, user, platform and Canvas site started the connection;
 *        it expires after 15 minutes so an old link cannot be replayed.
 * WHERE: publishing router (start), the callback route (read).
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

import { APP_URL, PUBLISHING_CALLBACK_PATH } from '@/lib/config'
import { connectStateSchema, type ConnectState } from '@/lib/types'

const STATE_TTL_MS = 15 * 60_000

export const publishingRedirectUri = () => `${APP_URL.replace(/\/+$/, '')}${PUBLISHING_CALLBACK_PATH}`

function stateSecret(): string {
  const secret = process.env['BETTER_AUTH_SECRET']
  if (!secret) throw new Error('BETTER_AUTH_SECRET is not set, so connections cannot be signed.')
  return secret
}

function sign(payload: string): string {
  return createHmac('sha256', stateSecret()).update(payload).digest('base64url')
}

export function signConnectState(state: Omit<ConnectState, 'expiresAt'>): string {
  const payload = Buffer.from(JSON.stringify({ ...state, expiresAt: Date.now() + STATE_TTL_MS })).toString('base64url')
  return `${payload}.${sign(payload)}`
}

/** The verified state, or null when it is forged, malformed or expired. */
export function readConnectState(value: string): ConnectState | null {
  const [payload, signature] = value.split('.')
  if (!payload || !signature) return null
  const expected = Buffer.from(sign(payload))
  const given = Buffer.from(signature)
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null
  try {
    const parsed = connectStateSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
    if (!parsed.success || parsed.data.expiresAt < Date.now()) return null
    return parsed.data
  } catch {
    return null
  }
}
