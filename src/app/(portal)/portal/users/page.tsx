/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: PortalUsersPage
 *
 * WHAT:  /portal/users — every user on the platform.
 * WHERE: Gated by the (portal) layout.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { PortalUsers } from './_components/portal-users'

export const metadata: Metadata = {
  title: 'Users',
}

export default function PortalUsersPage() {
  return (
    <ContentLayout title="Users" description="Everyone with an account on the platform.">
      <PortalUsers />
    </ContentLayout>
  )
}
