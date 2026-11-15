/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: PortalOrganizationsPage
 *
 * WHAT:  /portal/organizations — every tenant organization.
 * WHERE: Gated by the (portal) layout.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { PortalOrganizations } from './_components/portal-organizations'

export const metadata: Metadata = {
  title: 'Organizations',
}

export default function PortalOrganizationsPage() {
  return (
    <ContentLayout title="Organizations" description="Every workspace on the platform.">
      <PortalOrganizations />
    </ContentLayout>
  )
}
