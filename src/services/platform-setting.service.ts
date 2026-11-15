/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: listPlatformSettings, savePlatformSettings,
 *   PlatformSetting, platform_setting, platform settings data access
 *
 * WHAT:  Reads and writes PlatformSetting rows.
 * WHY:   The only layer that touches the table. Values arrive already
 *        serialized, and secrets already encrypted, from the portal router.
 *        Upserts and deletes run in one transaction so a group saves whole.
 * WHERE: src/lib/platform-settings/loader.ts (runtime reads),
 *        src/trpc/routers/portal.ts (getSettings / updateSettings).
 */

import type { PlatformSetting } from '@/generated/prisma'
import { prisma } from '@/lib/config/prisma'

export async function listPlatformSettings(): Promise<PlatformSetting[]> {
  return prisma.platformSetting.findMany()
}

export async function savePlatformSettings(params: {
  upserts: ReadonlyArray<Pick<PlatformSetting, 'key' | 'value' | 'isSecret'>>
  deletes: readonly string[]
  updatedById: string
}): Promise<void> {
  await prisma.$transaction([
    ...params.upserts.map((row) =>
      prisma.platformSetting.upsert({
        where: { key: row.key },
        create: { ...row, updatedById: params.updatedById },
        update: { value: row.value, isSecret: row.isSecret, updatedById: params.updatedById },
      })
    ),
    prisma.platformSetting.deleteMany({ where: { key: { in: [...params.deletes] } } }),
  ])
}
