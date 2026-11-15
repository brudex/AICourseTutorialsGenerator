/**
 * SOURCE OF TRUTH KEYWORDS: AccountSettingsPage, /dashboard/settings/account,
 *   ROUTES.account, user account page, profile settings route
 *
 * WHAT:  /dashboard/settings/account — the signed-in person's profile,
 *        password and signed in devices.
 * WHY:   Personal, not organization, settings: every signed-in member can open
 *        it, so it has no RESOURCES nav entry (that would gate it behind an
 *        organization permission). Reached from the user menu and the
 *        settings hub. Server shell + provider-aware client surface.
 * WHERE: ROUTES.account; linked from NavUser ("Account").
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { AccountScreen } from '@/components/global/providers/server'

export const metadata: Metadata = {
  title: 'Account',
}

export default function AccountSettingsPage() {
  return (
    <ContentLayout title="Account" description="Your profile, password and signed in devices.">
      <AccountScreen />
    </ContentLayout>
  )
}
