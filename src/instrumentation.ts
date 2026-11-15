/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: register, instrumentation, ensurePlatformSettings,
 *   server boot, platform settings prime
 *
 * WHAT:  Next.js server boot hook: loads portal settings before the first
 *        request is served.
 * WHY:   Settings readers are synchronous; priming here means the very first
 *        request already sees saved values instead of the defaults. Node only,
 *        because the loader uses Prisma.
 * WHERE: Called once by Next.js on server start (dev, next start, desktop).
 */
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return
  const { ensurePlatformSettings } = await import('@/lib/platform-settings/loader')
  await ensurePlatformSettings()
}
