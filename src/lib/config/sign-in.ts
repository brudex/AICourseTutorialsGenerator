/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

import { platformSettingText } from '@/lib/platform-settings'
import type { OAuthApp } from '@/lib/types'

/**
 * SOURCE OF TRUTH KEYWORDS: googleSignInApp, isGoogleSignInEnabled,
 *   googleSignInClientId, googleSignInClientSecret, Continue with Google
 *
 * WHAT:  The Google OAuth client used for sign in, from portal settings.
 * WHY:   One source for both the server (Better Auth provider config) and the
 *        sign in page (whether to show the Google button), so they can never
 *        disagree. Both halves must be set; one alone counts as off.
 * WHERE: src/lib/better-auth/auth.ts, active.better-auth.tsx (AuthForm prop),
 *        src/lib/publishing/apps.ts (Google publishing fallback).
 */
export function googleSignInApp(): OAuthApp | null {
  const clientId = platformSettingText('googleSignInClientId')
  const clientSecret = platformSettingText('googleSignInClientSecret')
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

export function isGoogleSignInEnabled(): boolean {
  return googleSignInApp() !== null
}
