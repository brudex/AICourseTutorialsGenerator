/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: ensurePlatformSettings, loadSavedPlatformSettings,
 *   platform settings loader, decrypt settings, instrumentation register
 *
 * WHAT:  Loads saved PlatformSetting rows (secrets decrypted) into the runtime
 *        store and primes it once per process.
 * WHY:   Kept apart from ./store so code that only reads settings never pulls
 *        Prisma in. A secret that cannot be decrypted (encryption key changed)
 *        is skipped and logged rather than failing every read.
 * WHERE: src/instrumentation.ts (web server boot), src/worker/index.ts.
 */

import { decryptApiKey } from '@/lib/ai/crypto'
import { PLATFORM_SETTING_FIELDS } from '@/lib/config/platform-settings'
import * as platformSettingService from '@/services/platform-setting.service'
import { primePlatformSettings, registerPlatformSettingsLoader } from './store'

async function loadSavedPlatformSettings(): Promise<ReadonlyMap<string, string>> {
  const rows = await platformSettingService.listPlatformSettings()
  const saved = new Map<string, string>()
  for (const row of rows) {
    if (!PLATFORM_SETTING_FIELDS.has(row.key)) continue
    try {
      saved.set(row.key, row.isSecret ? decryptApiKey(row.value) : row.value)
    } catch (error) {
      console.error(
        `[platform-settings] could not decrypt "${row.key}":`,
        error instanceof Error ? error.message : String(error)
      )
    }
  }
  return saved
}

export async function ensurePlatformSettings(): Promise<void> {
  registerPlatformSettingsLoader(loadSavedPlatformSettings)
  await primePlatformSettings()
}
