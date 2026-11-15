/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: platformSettingText, platformSettingFlag,
 *   platformSettingNumber, platformSettingSource, refreshPlatformSettings,
 *   primePlatformSettings, registerPlatformSettingsLoader, runtime settings
 *   store, stale while revalidate, hot reload configuration
 *
 * WHAT:  The in-process cache of operator settings and the typed, synchronous
 *        readers the rest of the app calls (storage driver, email key, worker
 *        concurrency, …).
 * WHY:   Readers stay synchronous so call sites such as getStorage() did not
 *        have to become async. A read older than PLATFORM_SETTINGS_REFRESH_MS
 *        returns the cached value and refreshes in the background, so a change
 *        saved in the portal reaches every process (web and worker) within a
 *        few seconds with no restart. Resolution order: saved value, then the
 *        legacy server file variable, then the registry default.
 *        State lives on globalThis so every Next module graph in the process
 *        (route handlers, RSC, proxy) shares one cache. This file never touches
 *        the database: the loader in ./loader registers itself, which keeps
 *        Prisma out of anything that only reads.
 * WHERE: src/lib/config/{resend,registration}, src/lib/publishing/apps,
 *        src/lib/storage, src/lib/render, src/lib/rate-limit,
 *        src/lib/ai/url-guard, src/worker, portal router.
 */

import { PLATFORM_SETTING_FIELDS, PLATFORM_SETTINGS_REFRESH_MS } from '@/lib/config/platform-settings'
import type {
  PlatformSettingKey,
  PlatformSettingKeyOf,
  PlatformSettingsLoader,
  PlatformSettingSource,
  PlatformSettingsStoreState,
} from '@/lib/types'

const STORE_KEY = Symbol.for('app.platformSettings')

type GlobalWithPlatformSettings = typeof globalThis & {
  [STORE_KEY]?: PlatformSettingsStoreState
}

function state(): PlatformSettingsStoreState {
  const holder = globalThis as GlobalWithPlatformSettings
  holder[STORE_KEY] ??= { saved: null, loadedAt: 0, inflight: null, loader: null }
  return holder[STORE_KEY]
}

/**
 * SOURCE OF TRUTH KEYWORDS: registerPlatformSettingsLoader
 *
 * WHAT:  Hands the store the function that reads saved settings.
 * WHERE: src/lib/platform-settings/loader.ts.
 */
export function registerPlatformSettingsLoader(loader: PlatformSettingsLoader): void {
  state().loader = loader
}

/**
 * SOURCE OF TRUTH KEYWORDS: refreshPlatformSettings
 *
 * WHAT:  Reloads saved settings now; concurrent callers share one load.
 * WHY:   A failed load (database down, table not migrated yet) keeps the last
 *        good values and still counts as a refresh, so reads fall back to the
 *        server file and defaults instead of retrying on every call.
 * WHERE: portal.updateSettings after a save, primePlatformSettings.
 */
export async function refreshPlatformSettings(): Promise<void> {
  const store = state()
  const loader = store.loader
  if (!loader) return
  store.inflight ??= loader()
    .then((saved) => {
      store.saved = saved
    })
    .catch((error: Error) => {
      console.error('[platform-settings] could not load saved settings:', error.message)
      store.saved ??= new Map()
    })
    .finally(() => {
      store.loadedAt = Date.now()
      store.inflight = null
    })
  await store.inflight
}

/**
 * SOURCE OF TRUTH KEYWORDS: primePlatformSettings
 *
 * WHAT:  Loads settings once if they were never loaded in this process.
 * WHERE: src/lib/platform-settings/loader.ts (ensurePlatformSettings).
 */
export async function primePlatformSettings(): Promise<void> {
  if (state().saved === null) await refreshPlatformSettings()
}

function refreshIfStale(): void {
  const store = state()
  if (!store.loader || store.inflight) return
  if (Date.now() - store.loadedAt < PLATFORM_SETTINGS_REFRESH_MS) return
  void refreshPlatformSettings()
}

function nonEmpty(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolvePlatformSetting, platformSettingSource
 *
 * WHAT:  The serialized value of a setting and where it came from.
 * WHERE: Typed readers below; portal router (view).
 */
export function resolvePlatformSetting(key: PlatformSettingKey): { value: string; source: PlatformSettingSource } {
  refreshIfStale()
  const field = PLATFORM_SETTING_FIELDS.get(key)
  const saved = state().saved?.get(key)
  if (nonEmpty(saved)) return { value: saved, source: 'saved' }
  const fromServer = field?.envFallback ? process.env[field.envFallback] : undefined
  if (nonEmpty(fromServer)) return { value: fromServer.trim(), source: 'server' }
  return { value: field?.defaultValue ?? '', source: 'default' }
}

export function platformSettingSource(key: PlatformSettingKey): PlatformSettingSource {
  return resolvePlatformSetting(key).source
}

/** A text, select or JSON setting; empty string when unset. */
export function platformSettingText(key: PlatformSettingKeyOf<'text' | 'select' | 'json'>): string {
  return resolvePlatformSetting(key).value
}

/** A switch setting. */
export function platformSettingFlag(key: PlatformSettingKeyOf<'boolean'>): boolean {
  return resolvePlatformSetting(key).value === 'true'
}

/** A whole number setting, clamped to its registry bounds. */
export function platformSettingNumber(key: PlatformSettingKeyOf<'number'>): number {
  const field = PLATFORM_SETTING_FIELDS.get(key)
  const fallback = Number.parseInt(field?.defaultValue ?? '0', 10)
  const parsed = Number.parseInt(resolvePlatformSetting(key).value, 10)
  const value = Number.isFinite(parsed) ? parsed : fallback
  return Math.min(field?.max ?? value, Math.max(field?.min ?? value, value))
}
