/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: SignUpPage
 *
 * WHAT:  /sign-up route — renders AuthShell + AuthForm in sign-up mode.
 *        Redirects to sign in when sign up is closed in portal settings
 *        (the proxy does the same; this check covers a direct render).
 * WHY:   Mirrors sign-in/page.tsx; keeps every page in (auth) cookie-cutter.
 * WHERE: Bounced to /sign-in by src/proxy.ts when isRegistrationOpen() is false.
 */

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { AuthForm, AuthShell } from '@/components/global/auth'
import { AUTH_ROUTES, isRegistrationOpen, resolveAuthCallback } from '@/lib/config'

export const metadata: Metadata = {
  title: 'Create account',
}

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackURL?: string | string[] }>
}) {
  if (!isRegistrationOpen()) redirect(AUTH_ROUTES.signIn)

  /* RETURN_TO_AFTER_AUTH: whoever sent the visitor here may have said where to
   * put them afterwards — an invitation link is the case that matters, since
   * dropping it strands an invitee on the dashboard with no idea they were
   * invited. resolveAuthCallback refuses anything that is not a site-relative
   * path (OPEN_REDIRECT_GUARD), and AuthScreen falls back to '/' on null. */
  const { callbackURL } = await searchParams
  const destination = resolveAuthCallback(callbackURL)

  return (
    <AuthShell>
      <AuthForm mode="sign-up" {...(destination ? { callbackURL: destination } : {})} />
    </AuthShell>
  )
}
