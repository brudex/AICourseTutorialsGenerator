/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: PortalHomePage
 *
 * WHAT:  /portal home — platform overview stats.
 * WHERE: Gated by the (portal) layout.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { PortalOverview } from './_components/portal-overview'

export const metadata: Metadata = {
  title: 'Platform',
}

export default function PortalHomePage() {
  return (
    <ContentLayout title="Platform overview" description="Every workspace and user on this platform.">
      <PortalOverview />
    </ContentLayout>
  )
}
