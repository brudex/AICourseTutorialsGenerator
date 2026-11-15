/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

import { platformSettingFlag } from '@/lib/platform-settings'

/**
 * SOURCE OF TRUTH KEYWORDS: isRegistrationOpen, REGISTRATION_OPEN,
 *   registrationOpen, invitation only, closed sign up
 *
 * WHAT:  Whether self-serve sign-up is allowed right now.
 * WHY:   Read per request from the portal setting `registrationOpen`, so the
 *        operator can close or reopen sign up without a restart. The auth.ts
 *        databaseHooks.user.create.before hook enforces it server-side as the
 *        last line of defense.
 * WHERE: auth.ts (server gate), src/proxy.ts and the sign-up page (redirect).
 */
export function isRegistrationOpen(): boolean {
  return platformSettingFlag('registrationOpen')
}
