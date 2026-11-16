/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: metadata, RootLayout, UpgradeModalProvider,
 *   GLOBAL_UPGRADE_SURFACE
 *
 * WHAT:  Root <html>/<body> layout, global metadata, and the mount point for
 *        TRPCReactProvider (which hosts the QueryClient, the optimistic
 *        feature-gate observer, and the AuthRedirectObserver).
 * WHY:   The tRPC provider has to wrap every page so `trpc.X.useQuery()`
 *        calls anywhere in the tree share one cache, and so the cache
 *        observers (auth-redirect, feature-gate) can see every query /
 *        mutation. Mounting it at the root layout is the single place that
 *        makes that true for all routes.
 *        AuthBoundary sits OUTSIDE TRPCReactProvider because a provider's own
 *        React context must be available to anything that reads auth state,
 *        including components rendered by tRPC consumers. Better Auth needs no
 *        context, so it renders children untouched.
 * WHERE: Reads BRANDING from src/lib/config; wraps every route segment under
 *        src/app/; renders AuthBoundary from src/components/global/providers and
 *        TRPCReactProvider from src/trpc/react-provider.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { BRANDING } from '@/lib/config'
import {
  hasMissingRequiredEnv,
  getEnvChecklist,
  getOptionalEnvChecklist,
} from '@/lib/config/required-env'
import { TRPCReactProvider } from '@/trpc/react-provider'
import { AuthBoundary } from '@/components/global/providers/server'
import { ThemeProvider } from '@/components/theme-provider'
import { SetupChecklist } from '@/components/global/setup-checklist'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'

/* Geist is the app-wide sans font (matches funnelmods). Its variable
 * (--font-geist-sans) is set on <html>, where globals.css's `html { @apply
 * font-sans }` + `--font-sans: var(--font-geist-sans)` resolve it. Geist Mono
 * backs --font-geist-mono / the `font-mono` utility. */
const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  metadataBase: BRANDING.metadataBase,
  title: {
    default: BRANDING.appName,
    template: `%s | ${BRANDING.appName}`,
  },
  description: BRANDING.appDescription,
}

/* The setup gate reads secrets that exist only at runtime. Prerendering this
 * layout during `next build` freezes the "missing" checklist into the image. */
export const dynamic = 'force-dynamic'

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn('h-full', geistSans.variable, geistMono.variable)}
    >
      <body className="min-h-full flex flex-col antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          forcedTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          {/* Developer setup gate: until every REQUIRED env var is set, show the
              checklist instead of the app (optional integrations fail soft and
              are not gated). */}
          {hasMissingRequiredEnv() ? (
            <SetupChecklist items={getEnvChecklist()} optional={getOptionalEnvChecklist()} envFileFound={existsSync(path.join(process.cwd(), '.env'))} />
          ) : (
            <AuthBoundary>
              <TRPCReactProvider>
                {/* GLOBAL_UPGRADE_SURFACE: one upgrade modal for the whole app.
                    It sits INSIDE the tRPC provider because it opens itself off
                    the query/mutation caches whenever the server refuses a call
                    for plan reasons — see UpgradeModalProvider. Mounting it here
                    rather than per feature is what makes every gate, current and
                    future, land on the same screen. */}
                {children}
              </TRPCReactProvider>
            </AuthBoundary>
          )}
          <Toaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  )
}
