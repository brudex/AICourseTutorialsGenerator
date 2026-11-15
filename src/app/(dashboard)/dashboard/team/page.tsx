/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: TeamPage
 *
 * WHAT:  /dashboard/team route — thin shell; TeamClient does the work.
 * WHERE: RESOURCES.member.nav.href.
 */

import type { Metadata } from 'next'

import { TeamClient } from './_components/team-client'
import { MemberManagement } from '@/components/global/providers/server'

export const metadata: Metadata = {
  title: 'Team',
}

export default function TeamPage() {
  return <TeamClient memberManagement={<MemberManagement />} />
}
