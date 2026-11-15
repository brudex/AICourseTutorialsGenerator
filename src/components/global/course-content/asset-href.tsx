'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: AssetHrefProvider, useAssetHref, asset link
 *   builder, download links per surface
 *
 * WHAT:  Context for building links to stored files (downloads) inside the
 *        course content components.
 * WHY:   Studio pages serve files through /api/assets (team membership
 *        checked); a school serves the same files through its own route that
 *        checks the student's enrollment. Components ask the context instead
 *        of hardcoding a route, so one MaterialList works on every surface.
 * WHERE: MaterialList (reads); the school course player (provides).
 */

import * as React from 'react'

type AssetHref = (assetId: string) => string

const studioHref: AssetHref = (assetId) => `/api/assets/${assetId}`
const AssetHrefContext = React.createContext<AssetHref>(studioHref)

export function AssetHrefProvider({ href, children }: { href: AssetHref; children: React.ReactNode }) {
  return <AssetHrefContext.Provider value={href}>{children}</AssetHrefContext.Provider>
}

export function useAssetHref(): AssetHref {
  return React.useContext(AssetHrefContext)
}
