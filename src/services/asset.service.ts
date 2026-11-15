import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: assetService, upsertAsset, findAssetById,
 *   sumOrganizationStorageBytes, Asset rows
 *
 * WHAT:  Pure Prisma for Asset rows — the database record of every stored
 *        media file.
 * WHY:   Upsert by storageKey: re-rendering a scene overwrites the same file
 *        and must update (not duplicate) its row. Storage usage is summed from
 *        `bytes` (exact, BigInt-safe via aggregate) rather than kept in the
 *        32-bit UsageMetrics counter.
 * WHERE: Visual renderer (writes), /api/assets/[assetId] (reads), usage.
 */

import type { Prisma } from '@/generated/prisma'
import type { DbClient } from '@/lib/config'

export function upsertAsset(db: DbClient, data: Prisma.AssetUncheckedCreateInput) {
  return db.asset.upsert({
    where: { storageKey: data.storageKey },
    create: data,
    update: {
      mimeType: data.mimeType,
      bytes: data.bytes,
      width: data.width ?? null,
      height: data.height ?? null,
      durationMs: data.durationMs ?? null,
      sourceTaskId: data.sourceTaskId ?? null,
    },
    select: { id: true },
  })
}

export function findAssetById(db: DbClient, assetId: string) {
  return db.asset.findUnique({
    where: { id: assetId },
    select: { id: true, organizationId: true, courseId: true, storageKey: true, mimeType: true, kind: true, bytes: true, updatedAt: true },
  })
}

export async function sumOrganizationStorageBytes(db: DbClient, organizationId: string): Promise<number> {
  const result = await db.asset.aggregate({ where: { organizationId }, _sum: { bytes: true } })
  return result._sum.bytes ?? 0
}
