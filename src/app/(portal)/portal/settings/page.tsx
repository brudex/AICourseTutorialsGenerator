/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: PortalSettingsPage, portal settings route,
 *   platform settings page
 *
 * WHAT:  /portal/settings — the operator settings that apply without a restart.
 * WHERE: Gated by the (portal) layout; linked from PortalSidebar.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { PlatformSettings } from './_components/platform-settings'

export const metadata: Metadata = {
  title: 'Settings',
}

export default function PortalSettingsPage() {
  return (
    <ContentLayout title="Settings" description="Platform settings that apply in seconds, no restart needed.">
      <PlatformSettings />
    </ContentLayout>
  )
}
