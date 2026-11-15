import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: publishingGoogleApp, publishingCanvasApp,
 *   publishingVimeoApp, GOOGLE_PUBLISHING_CLIENT_ID, CANVAS_OAUTH_APPS,
 *   VIMEO_CLIENT_ID, operator OAuth keys,
 *   PublishingOAuthApp config
 *
 * WHAT:  The OAuth apps the platform operator registered: one Google Cloud
 *        client (YouTube, Google Classroom, Google Drive), one Vimeo app, and
 *        one Canvas developer key per school Canvas site. Read from server environment only.
 * WHY:   Customers never handle keys: the operator applies for them once and
 *        customers just click Connect and sign in to their own account.
 *        Canvas keys are per school (each school runs its own Canvas and
 *        issues developer keys), so they are a host → key map. A school with
 *        no key falls back to the access-token connect.
 * WHERE: src/lib/publishing/{connect,credentials}.ts and the publishing
 *        router (to tell the UI which platforms can connect).
 */

import { z } from 'zod'

export interface OAuthApp {
  clientId: string
  clientSecret: string
}

const canvasAppsSchema = z.record(
  z.string().min(1),
  z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1) })
)

/** The publishing Google client, else the sign-in client; null when neither is set. */
export function publishingGoogleApp(): OAuthApp | null {
  const clientId = process.env['GOOGLE_PUBLISHING_CLIENT_ID'] || process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID']
  const clientSecret = process.env['GOOGLE_PUBLISHING_CLIENT_SECRET'] || process.env['GOOGLE_CLIENT_SECRET']
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

function canvasApps(): Map<string, OAuthApp> {
  const raw = process.env['CANVAS_OAUTH_APPS']
  if (!raw) return new Map()
  try {
    const parsed = canvasAppsSchema.safeParse(JSON.parse(raw))
    if (!parsed.success) {
      console.error('[publishing] CANVAS_OAUTH_APPS is not a { "host": { clientId, clientSecret } } map')
      return new Map()
    }
    return new Map(Object.entries(parsed.data).map(([host, app]) => [host.toLowerCase(), app]))
  } catch {
    console.error('[publishing] CANVAS_OAUTH_APPS is not valid JSON')
    return new Map()
  }
}

/** The operator's Vimeo app (developer.vimeo.com); null when not set. */
export function publishingVimeoApp(): OAuthApp | null {
  const clientId = process.env['VIMEO_CLIENT_ID']
  const clientSecret = process.env['VIMEO_CLIENT_SECRET']
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/** The developer key registered for this Canvas site, if any. */
export function publishingCanvasApp(baseUrl: string): OAuthApp | null {
  const host = new URL(baseUrl).host.toLowerCase()
  return canvasApps().get(host) ?? null
}
