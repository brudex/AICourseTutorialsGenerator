/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: SettingsIndexPage
 *
 * WHAT:  /dashboard/settings — redirects to the account page.
 * WHY:   Settings has no landing of its own. Account is the one settings page
 *        every member can open (billing and the others are permission or
 *        subscription gated), so it is the safe default.
 * WHERE: Sub-pages: account, organization, ai-providers, audit-logs, billing.
 */

import { redirect } from 'next/navigation'

import { ROUTES } from '@/lib/config'

export default function SettingsIndexPage() {
  redirect(ROUTES.account)
}
