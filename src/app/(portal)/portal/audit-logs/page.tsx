/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: PortalAuditLogsPage
 *
 * WHAT:  /portal/audit-logs — platform-wide activity timeline.
 * WHERE: Gated by the (portal) layout.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { PortalActivity } from './_components/portal-activity'

export const metadata: Metadata = {
  title: 'Platform audit logs',
}

export default function PortalAuditLogsPage() {
  return (
    <ContentLayout title="Platform audit logs" description="Activity across every workspace.">
      <PortalActivity />
    </ContentLayout>
  )
}
