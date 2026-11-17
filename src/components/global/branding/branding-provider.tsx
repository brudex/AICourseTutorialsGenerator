/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: BrandingProvider, useBranding, BrandingContext,
 *   app name in browser, branding portal setting
 *
 * WHAT:  Hands the app name (a portal setting) to browser components.
 * WHY:   Browser code cannot read the database. The root layout reads the name
 *        on the server for every request and seeds this context, so a rename
 *        in the portal shows on the next page load with no rebuild.
 * WHERE: Mounted by src/app/layout.tsx; read by PlatformLogo and the
 *        WordPress connect dialog.
 */

import * as React from 'react'

import type { BrandingValues } from '@/lib/types'

const BrandingContext = React.createContext<BrandingValues>({ appName: 'Penrose Studio' })

export function BrandingProvider({ value, children }: { value: BrandingValues; children: React.ReactNode }) {
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
}

export function useBranding(): BrandingValues {
  return React.useContext(BrandingContext)
}
