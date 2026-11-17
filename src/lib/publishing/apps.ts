import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: publishingGoogleApp, publishingCanvasApp,
 *   publishingVimeoApp, googlePublishingClientId, canvasOAuthApps,
 *   vimeoClientId, operator OAuth keys, PublishingOAuthApp config
 *
 * WHAT:  The OAuth apps the platform operator registered: one Google Cloud
 *        client (YouTube, Google Classroom, Google Drive), one Vimeo app, and
 *        one Canvas developer key per school Canvas site. Read per call from
 *        the portal settings (Publishing apps), so new keys apply without a
 *        restart. Google falls back to the sign in client (also a portal setting).
 * WHY:   Customers never handle keys: the operator applies for them once and
 *        customers just click Connect and sign in to their own account.
 *        Canvas keys are per school (each school runs its own Canvas and
 *        issues developer keys), so they are a host → key map. A school with
 *        no key falls back to the access-token connect.
 * WHERE: src/lib/publishing/{connect,credentials}.ts and the publishing
 *        router (to tell the UI which platforms can connect).
 */

import { googleSignInApp } from '@/lib/config/sign-in'
import { platformSettingText } from '@/lib/platform-settings'
import { canvasOAuthAppsSchema, type OAuthApp } from '@/lib/types'

export type { OAuthApp } from '@/lib/types'

/** The publishing Google client, else the sign-in client; null when neither is set. */
export function publishingGoogleApp(): OAuthApp | null {
  const clientId = platformSettingText('googlePublishingClientId')
  const clientSecret = platformSettingText('googlePublishingClientSecret')
  return clientId && clientSecret ? { clientId, clientSecret } : googleSignInApp()
}

function canvasApps(): Map<string, OAuthApp> {
  const raw = platformSettingText('canvasOAuthApps')
  if (!raw) return new Map()
  try {
    const parsed = canvasOAuthAppsSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      console.error('[publishing] Canvas developer keys are not a { "host": { clientId, clientSecret } } map')
      return new Map()
    }
    return new Map(Object.entries(parsed.data).map(([host, app]) => [host.toLowerCase(), app]))
  } catch {
    console.error('[publishing] Canvas developer keys are not valid JSON')
    return new Map()
  }
}

/** The operator's Vimeo app (developer.vimeo.com); null when not set. */
export function publishingVimeoApp(): OAuthApp | null {
  const clientId = platformSettingText('vimeoClientId')
  const clientSecret = platformSettingText('vimeoClientSecret')
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/** The developer key registered for this Canvas site, if any. */
export function publishingCanvasApp(baseUrl: string): OAuthApp | null {
  const host = new URL(baseUrl).host.toLowerCase()
  return canvasApps().get(host) ?? null
}
