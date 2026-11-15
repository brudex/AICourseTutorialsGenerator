/**
 * SOURCE OF TRUTH KEYWORDS: ConnectionsSettingsPage, /dashboard/settings/connections,
 *   publishing connections page, RESOURCES.publishing.nav.href
 *
 * WHAT:  Settings page where a workspace connects YouTube, Google Classroom and
 *        Canvas, sets up its Google app, and finds the import guides for
 *        platforms that cannot be connected.
 * WHERE: RESOURCES.publishing.nav.href (gated by publishing:read).
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { ConnectionsSettings } from './_components/connections-settings'

export const metadata: Metadata = {
  title: 'Connections',
}

export default function ConnectionsSettingsPage() {
  return (
    <ContentLayout title="Connections" description="Connect the platforms your courses are published to.">
      <ConnectionsSettings />
    </ContentLayout>
  )
}
