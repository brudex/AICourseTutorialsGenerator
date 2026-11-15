/**
 * SOURCE OF TRUTH KEYWORDS: GET, publishingCallback, OAuth callback,
 *   PUBLISHING_CALLBACK_PATH, connect YouTube, connect Google Classroom,
 *   sign in with Canvas
 *
 * WHAT:  Where Google, Vimeo, a school's Canvas or a WordPress site sends
 *        the browser after someone approves a connection. Verifies the signed state, checks the
 *        signed-in user is the one who started, saves the connection through
 *        publishing.completeConnect, and returns to the Connections page with
 *        the outcome in the query string.
 * WHY:   A plain route because the platforms redirect here; the work itself
 *        runs through the procedure (createServerCaller) so the permission
 *        gate, audit row and transaction still apply. Errors become a short
 *        message on the Connections page, never a stack trace.
 * WHERE: Registered as the redirect URI in the operator's Google app and in
 *        each school's Canvas developer key.
 */

import { NextResponse, type NextRequest } from 'next/server'

import { getServerSession } from '@/lib/adapters/session'
import { readConnectState } from '@/lib/publishing'
import { createServerCaller } from '@/trpc/caller'

const CONNECTIONS_PATH = '/dashboard/settings/connections'

function back(request: NextRequest, params: Record<string, string>) {
  const url = new URL(CONNECTIONS_PATH, request.url)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams
  const denied = search.get('error')
  if (denied) return back(request, { error: denied === 'access_denied' ? 'Access was not granted, so nothing was connected.' : 'The sign-in did not finish. Please try again.' })

  const state = readConnectState(search.get('state') ?? '')
  /* OAuth platforms send a code; WordPress sends the approved user and
   * application password (authorize-application.php). */
  const code = search.get('code')
  const wpUser = search.get('user_login')
  const wpPassword = search.get('password')
  const wordpress = wpUser && wpPassword ? { username: wpUser, appPassword: wpPassword } : null
  if (!state || (!code && !wordpress)) return back(request, { error: 'This connection link expired. Please connect again.' })

  const session = await getServerSession()
  if (!session || session.user.id !== state.userId) {
    return back(request, { error: 'Sign in as the person who started the connection, then try again.' })
  }

  try {
    const caller = await createServerCaller()
    await caller.publishing.completeConnect({
      organizationId: state.organizationId,
      platform: state.platform,
      baseUrl: state.baseUrl,
      code,
      wordpress,
    })
    return back(request, { connected: state.platform })
  } catch (error) {
    return back(request, { error: (error instanceof Error ? error.message : 'Could not finish connecting.').slice(0, 300) })
  }
}
