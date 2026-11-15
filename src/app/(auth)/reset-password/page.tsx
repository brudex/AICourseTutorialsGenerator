/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: ResetPasswordPage
 *
 * WHAT:  /reset-password route — set a new password from the email link's token.
 * WHY:   The form reads `?token=` via useSearchParams, so it's wrapped in a
 *        Suspense boundary (Next.js requirement for static-generation compat).
 * WHERE: AUTH_ROUTES.resetPassword; the reset-link email lands here.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'

import { AuthShell, ResetPasswordForm } from '@/components/global/auth'

export const metadata: Metadata = {
  title: 'Reset password',
}

export default function ResetPasswordPage() {
  return (
    <AuthShell>
      <Suspense fallback={null}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  )
}
