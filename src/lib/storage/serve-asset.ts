import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: serveAsset, stored file response, range requests,
 *   signed url redirect, asset etag
 *
 * WHAT:  Builds the HTTP response for one stored file once the caller has
 *        been allowed to see it: S3 presigned redirect, or local bytes with
 *        Range support, ETag revalidation, optional download, and a locked
 *        down CSP for SVGs.
 * WHY:   The studio route (team membership) and the school route (student
 *        enrollment) check access differently but must serve files exactly
 *        the same way, so the serving lives here once.
 * WHERE: src/app/api/assets/[assetId]/route.ts,
 *        src/app/api/school/[slug]/assets/[assetId]/route.ts.
 */

import { NextResponse } from 'next/server'

import { getStorage } from './index'

const SIGNED_URL_TTL_SECONDS = 300

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return null
  const [, rawStart = '', rawEnd = ''] = match
  if (rawStart === '' && rawEnd === '') return null
  const start = rawStart === '' ? Math.max(0, size - Number(rawEnd)) : Number(rawStart)
  const end = rawStart !== '' && rawEnd !== '' ? Math.min(Number(rawEnd), size - 1) : size - 1
  return start <= end && start < size ? { start, end } : null
}

export async function serveAsset(
  request: Request,
  asset: { id: string; storageKey: string; mimeType: string; updatedAt: Date }
): Promise<NextResponse> {
  const etag = `"${asset.id}-${asset.updatedAt.getTime()}"`
  if (request.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers: { ETag: etag, 'Cache-Control': 'private, no-cache' } })
  }

  const download = new URL(request.url).searchParams.get('download') === '1'
  const fileName = asset.storageKey.split('/').pop() ?? 'file'
  const storage = getStorage()
  const signed = download ? null : await storage.signedUrl(asset.storageKey, SIGNED_URL_TTL_SECONDS)
  if (signed) return NextResponse.redirect(signed, 302)

  const object = await storage.get(asset.storageKey)
  if (!object) return new NextResponse('Not found', { status: 404 })

  const size = object.body.byteLength
  const headers: Record<string, string> = {
    'Content-Type': asset.mimeType,
    'Cache-Control': 'private, no-cache',
    ETag: etag,
    'X-Content-Type-Options': 'nosniff',
    'Accept-Ranges': 'bytes',
  }
  if (download) headers['Content-Disposition'] = `attachment; filename="${fileName.replace(/"/g, '')}"`
  if (asset.mimeType === 'image/svg+xml') {
    headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
  }

  const range = parseRange(request.headers.get('range'), size)
  if (request.headers.get('range') && !range) {
    return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }
  if (range) {
    const chunk = object.body.subarray(range.start, range.end + 1)
    headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
    headers['Content-Length'] = String(chunk.byteLength)
    return new NextResponse(Buffer.from(chunk), { status: 206, headers })
  }
  headers['Content-Length'] = String(size)
  return new NextResponse(Buffer.from(object.body), { status: 200, headers })
}
