/**
 * SOURCE OF TRUTH KEYWORDS: DashboardLoading, dashboard loading.tsx, route
 *   loading boundary, PageSkeleton
 *
 * WHAT:  The loading state for /dashboard and every nested route that has no
 *        loading file of its own.
 * WHY:   Next.js shows this the moment a link is clicked, so navigation
 *        responds instantly instead of holding the old page.
 * WHERE: Next.js App Router, (dashboard) route group.
 */

import { PageSkeleton } from '@/components/global/page-skeleton'

export default function DashboardLoading() {
  return <PageSkeleton />
}
