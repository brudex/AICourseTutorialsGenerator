/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: AuthShell, AuthShellProps, AUTH_SURFACE
 *
 * Brand blue is only a page background (this gradient, the app layout and
 * sidebar) or a button fill; the card itself stays the neutral bg-card.
 * WHAT:  The wrapper of every (auth) route (shadcn login-03): one centred
 *        borderless card holding the app icon, the name and the form, on the
 *        logo gradient (--brand-gradient: #1198F6 → #0754D8 → #072C91).
 * WHY:   Pulled out of the page files so future auth pages (forgot, reset,
 *        verify, 2fa) inherit the same chrome without duplicating layout
 *        markup, and so a branding redesign is a one-file change.
 *        AUTH_SURFACE: this file owns the one card every auth screen sits
 *        in. They previously disagreed: sign-in, sign-up, forgot and reset
 *        were bare while accept-invitation drew its own <Card>, so the same
 *        flow changed shape halfway through. Owning the surface here is what
 *        keeps them identical; a form that adds its own container is the bug
 *        this file exists to prevent.
 *        `max-w-md` over the original `max-w-sm`: at 24rem a two-field form
 *        plus a provider button reads as cramped, and the invitation screen —
 *        which carries an email address and three buttons — was visibly tight.
 *        Nothing else constrains the children, so a screen is free to be as
 *        tall as it needs.
 * WHERE: Used by the (auth) route group pages under src/app/(auth)/.
 */

import * as React from 'react'
import Image from 'next/image'
import Link from 'next/link'

import { APP_LOGO, appName } from '@/lib/config/branding'

export interface AuthShellProps {
  children: React.ReactNode
  /** Under the card, on the brand background (e.g. "Learning as a student?"). */
  footer?: React.ReactNode
}

export function AuthShell({ children, footer }: AuthShellProps) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-linear-135 from-brand-light via-primary via-45% to-brand p-6 md:p-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="rounded-2xl bg-card p-8 shadow-2xl sm:p-10">
          <Link href="/" className="mx-auto mb-6 flex w-fit flex-col items-center gap-3" aria-label={appName()}>
            <Image src={APP_LOGO} alt="" width={56} height={56} priority />
            <span className="text-sm font-medium text-muted-foreground">{appName()}</span>
          </Link>
          {children}
        </div>
        {footer ? <div className="text-center text-sm text-primary-foreground">{footer}</div> : null}
        <p className="text-center text-xs text-primary-foreground/80">
          © {new Date().getFullYear()} {appName()}
        </p>
      </div>
    </div>
  )
}
