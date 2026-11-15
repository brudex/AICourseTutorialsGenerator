/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: AuditLogsSettingsPage
 *
 * WHAT:  /dashboard/settings/audit-logs — forensic activity timeline.
 * WHERE: RESOURCES.auditLogs.nav.href (flag-gated, hidden below pro plans).
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { AuditLogsTable } from './_components/audit-logs-table'

export const metadata: Metadata = {
  title: 'Audit Logs',
}

export default function AuditLogsSettingsPage() {
  return (
    <ContentLayout title="Audit Logs" description="Who changed what in this workspace, and when.">
      <AuditLogsTable />
    </ContentLayout>
  )
}
