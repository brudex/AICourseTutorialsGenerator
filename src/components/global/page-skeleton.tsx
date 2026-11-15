/**
 * SOURCE OF TRUTH KEYWORDS: PageSkeleton, PageSkeletonProps, route loading,
 *   loading.tsx, navigation feedback, dashboard page placeholder
 *
 * WHAT:  A placeholder for a dashboard page while its route loads: the page
 *        header (with the working sidebar toggle) and a few content blocks
 *        in the same column as ContentLayout.
 * WHY:   Without a loading boundary a click keeps showing the old page until
 *        the next one is ready, so navigation feels stuck. Showing this
 *        immediately makes every route change respond on click. Reuses
 *        ContentLayout's padding and PageContainer so nothing jumps when the
 *        real page swaps in.
 * WHERE: src/app/(dashboard)/dashboard/loading.tsx (covers every nested
 *        dashboard route without its own loading file).
 */

import { PageContainer } from '@/components/global/page-container'
import { Separator } from '@/components/ui/separator'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Skeleton } from '@/components/ui/skeleton'

export interface PageSkeletonProps {
  /** How many content blocks to show under the header. */
  blocks?: number
}

export function PageSkeleton({ blocks = 3 }: PageSkeletonProps) {
  return (
    <div className="flex flex-1 flex-col p-4 md:p-6" aria-busy="true" aria-live="polite">
      <PageContainer width="lg" className="gap-4">
        <header className="flex shrink-0 items-center gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2" />
          <Skeleton className="h-5 w-32" />
        </header>
        <Skeleton className="h-8 w-64" />
        {Array.from({ length: blocks }, (_, i) => (
          <Skeleton key={i} className={i === 0 ? 'h-32 w-full rounded-xl' : 'h-48 w-full rounded-xl'} />
        ))}
        <span className="sr-only">Loading</span>
      </PageContainer>
    </div>
  )
}
