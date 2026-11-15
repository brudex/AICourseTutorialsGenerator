/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: platform-settings barrel, platformSettingText,
 *   platformSettingFlag, platformSettingNumber, refreshPlatformSettings
 *
 * WHAT:  The read side of operator settings.
 * WHY:   The loader (./loader, Prisma) is imported on its own by the processes
 *        that boot it, so importing this barrel never pulls in the database.
 * WHERE: Every runtime consumer of a portal setting.
 */

export {
  platformSettingText,
  platformSettingFlag,
  platformSettingNumber,
  platformSettingSource,
  resolvePlatformSetting,
  refreshPlatformSettings,
} from './store'
