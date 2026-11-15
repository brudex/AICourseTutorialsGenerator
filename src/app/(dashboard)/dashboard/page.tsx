/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: DashboardHomePage, studio dashboard route
 *
 * WHAT:  Dashboard landing page inside the sidebar shell.
 * WHY:   Server shell only: sets the title and renders DashboardHome, which
 *        loads each card's data on the client per permission.
 * WHERE: Route /dashboard under the (dashboard) layout.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { DashboardHome } from './_components/dashboard-home'

export const metadata: Metadata = {
  title: 'Dashboard',
}

export default function DashboardHomePage() {
  return (
    <ContentLayout title="Dashboard" heading={false}>
      <DashboardHome />
    </ContentLayout>
  )
}
