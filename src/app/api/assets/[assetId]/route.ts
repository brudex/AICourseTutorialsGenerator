/**
 * SOURCE OF TRUTH KEYWORDS: assetRoute, GET /api/assets/[assetId], serve
 *   media, asset access control
 *
 * WHAT:  Serves one stored media file (still, diagram, later audio/video/
 *        downloads) to a signed-in member of the organization that owns it.
 * WHY:   Storage stays private; this route is the only door. Access is
 *        checked against the caller's memberships (provider-neutral via the
 *        auth adapter), and a non-member gets 404 — never confirmation that
 *        the asset exists. S3 storage answers with a 5-minute presigned
 *        redirect so large files bypass the app server; local storage streams
 *        the bytes. SVGs get a locked-down CSP so a crafted diagram can never
 *        run script on this origin. Local storage answers HTTP Range requests
 *        (206 Partial Content) so <video> can seek; `?download=1` sends the
 *        file as an attachment. Re-rendering overwrites a file under the same
 *        asset id, so responses carry an ETag (id + updatedAt) with
 *        `no-cache`: browsers revalidate every time and get a cheap 304 when
 *        unchanged, but never replay an outdated render from cache.
 * WHERE: <img>/<video> sources in the storyboard and learner player.
 */

import { NextResponse } from 'next/server'

import { prisma } from '@/lib/config'
import { getAuthAdapter } from '@/lib/adapters'
import { getServerSession } from '@/lib/adapters/session'
import { serveAsset } from '@/lib/storage/serve-asset'
import * as assetService from '@/services/asset.service'

export const runtime = 'nodejs'

export async function GET(request: Request, { params }: { params: Promise<{ assetId: string }> }) {
  const { assetId } = await params
  const session = await getServerSession()
  if (!session) return new NextResponse('Unauthorized', { status: 401 })

  const asset = await assetService.findAssetById(prisma, assetId)
  if (!asset) return new NextResponse('Not found', { status: 404 })

  const adapter = await getAuthAdapter()
  const memberships = await adapter.tenancy.getMemberships(session.user.id)
  if (!memberships.some((m) => m.organizationId === asset.organizationId)) {
    return new NextResponse('Not found', { status: 404 })
  }
  return serveAsset(request, asset)
}
