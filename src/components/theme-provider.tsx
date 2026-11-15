/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: ThemeProvider
 *
 * WHAT:  Client wrapper around next-themes' ThemeProvider — applies a `.dark`
 *        or `.light` class to <html> so the Tailwind/shadcn token variables
 *        switch on the right selector.
 * WHY:   shadcn's CSS keys dark mode off the `.dark` class on a parent
 *        element; next-themes is the canonical way to inject that class
 *        before hydration without a flash of incorrect theme. Wrapping is
 *        required because next-themes is a client component.
 * WHERE: Mounted by src/app/layout.tsx around the rest of the app tree;
 *        consumed implicitly by every component that uses dark: classes or
 *        reads useTheme() (e.g. src/components/ui/sonner.tsx).
 */

'use client'

import * as React from 'react'
import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type { ThemeProviderProps } from 'next-themes'

/**
 * SOURCE OF TRUTH KEYWORDS: THEME_SCRIPT_PROPS, next-themes script warning,
 *   theme flash script, React 19 script tag
 * WHAT:  On the server the theme script renders as a normal script, so it runs
 *        before paint (no theme flash). In the browser it is re-rendered as
 *        inert JSON, so React does not warn about a script inside a component.
 * WHY:   The script has already run by then; next-themes marks it
 *        suppressHydrationWarning, so the type difference is harmless.
 */
const THEME_SCRIPT_PROPS: NonNullable<ThemeProviderProps['scriptProps']> = typeof window === 'undefined' ? {} : { type: 'application/json' }

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return <NextThemesProvider scriptProps={THEME_SCRIPT_PROPS} {...props}>{children}</NextThemesProvider>
}
