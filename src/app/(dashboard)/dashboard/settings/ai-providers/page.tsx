/**
 * SOURCE OF TRUTH KEYWORDS: AiProvidersSettingsPage
 *
 * WHAT:  /dashboard/settings/ai-providers — connect AI providers, register
 *        models and prices, route capabilities to models.
 * WHY:   Bring-your-own-key: every agent call is routed through what this page
 *        configures (src/lib/ai). Access is gated by ROUTE_AUTHORIZATION via
 *        RESOURCES.aiProviders.nav (aiProviders:read).
 * WHERE: RESOURCES.aiProviders.nav.href.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { AiProvidersSettings } from './_components/ai-providers-settings'

export const metadata: Metadata = {
  title: 'AI Providers',
}

export default function AiProvidersSettingsPage() {
  return (
    <ContentLayout title="AI Providers" description="The model providers, models and voice your courses are built with.">
      <AiProvidersSettings />
    </ContentLayout>
  )
}
