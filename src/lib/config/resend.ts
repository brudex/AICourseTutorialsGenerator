/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: resend, getResendClient, resendDefaultFrom,
 *   isResendConfigured, resendApiKey
 *
 * WHAT:  Lazy Resend client singleton plus the resolved default "From" address.
 * WHY:   The SDK is constructed on first send (not at import) so a missing
 *        Resend key never throws during build/import — the email service
 *        guards on isResendConfigured() and no-ops in that case, mirroring the
 *        rate-limiter's fail-open posture so local dev runs without an account.
 * WHERE: Consumed by src/services/email.service.ts; re-exported from
 *        src/lib/config/index.ts.
 */

import { Resend } from 'resend'
import { appName } from '@/lib/config/branding'
import { platformSettingText } from '@/lib/platform-settings'

/**
 * SOURCE OF TRUTH KEYWORDS: resendDefaultFrom, RESEND_DEFAULT_FROM, resendFromEmail
 *
 * WHAT:  The `Name <email>` From header used for every transactional send.
 * WHY:   Read per send from the portal setting `resendFromEmail`, so a new
 *        sender address applies without a restart. Its registry default is the
 *        Resend sandbox address.
 * WHERE: Default `from` in src/services/email.service.ts.
 */
export function resendDefaultFrom(): string {
  return `${appName()} <${platformSettingText('resendFromEmail')}>`
}

/**
 * SOURCE OF TRUTH KEYWORDS: isResendConfigured
 *
 * WHAT:  True when the portal setting `resendApiKey` is set.
 * WHY:   The email service checks this before sending so a missing key is a
 *        warn-and-no-op, not a crash.
 * WHERE: Guard in src/services/email.service.ts.
 */
export function isResendConfigured(): boolean {
  return platformSettingText('resendApiKey').length > 0
}

/**
 * SOURCE OF TRUTH KEYWORDS: isDevEmailFallbackActive, devEmailFallback,
 *   requireEmailVerification, dev email toast
 *
 * WHAT:  True in exactly one state — local development with no email provider
 *        configured. The single source of truth for "emails can't be delivered,
 *        so fall back to surfacing action links in the UI".
 * WHY:   Without a provider, sign-up would dead-end on "check your email" with
 *        the verification link only reachable in the server console. While this
 *        is active, email verification is not enforced at sign-in and the
 *        verification link is handed to the client for a toast. Both relaxations
 *        MUST flip off together, hence one predicate rather than two — and both
 *        are impossible in production because NODE_ENV gates them.
 * WHERE: auth.ts (requireEmailVerification), src/trpc/routers/dev.ts
 *        (getPendingEmail gate).
 */
export function isDevEmailFallbackActive(): boolean {
  return process.env.NODE_ENV === 'development' && !isResendConfigured()
}

/* Rebuilt when the key changes in the portal. */
let client: { apiKey: string; resend: Resend } | null = null

/**
 * SOURCE OF TRUTH KEYWORDS: getResendClient
 *
 * WHAT:  Returns the cached Resend client, or null when no API key is set.
 * WHY:   Lazy construction keeps `new Resend()` out of the import path so the
 *        bundle builds without the key; the instance is cached after first use.
 * WHERE: Called by src/services/email.service.ts.
 */
export function getResendClient(): Resend | null {
  const apiKey = platformSettingText('resendApiKey')
  if (!apiKey) return null
  if (client?.apiKey !== apiKey) client = { apiKey, resend: new Resend(apiKey) }
  return client.resend
}
