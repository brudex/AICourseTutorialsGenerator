'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: DashboardHome, studio dashboard, studio home,
 *   KPI row, greeting
 *
 * WHAT:  The studio home, laid out like the shadcn dashboard-01 block: a
 *        greeting with "New course", the getting-started steps (until done),
 *        KPI section cards, the AI usage area chart, and a tabbed table of
 *        recent courses, agent activity and models.
 * WHY:   Each card asks for exactly the permission its data needs, so a
 *        member without generationJobs:read or aiProviders:read still gets a
 *        useful page without those cards. Data per card comes from the
 *        dashboard router; this file only lays them out.
 * WHERE: /dashboard.
 */

import Link from 'next/link'
import { PlusIcon } from 'lucide-react'

import { trpc } from '@/trpc/react-provider'
import { useActiveOrganization } from '@/hooks/use-active-organization'
import { permissions } from '@/lib/permissions'
import { buttonVariants } from '@/components/ui/button'
import { PageHeading } from '@/components/global/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { SetupStepsCard } from './setup-steps-card'
import { SectionCards, SectionCardsSkeleton } from './section-cards'
import { UsageChart } from './usage-chart'
import { OverviewTables } from './overview-tables'

function greeting(): string {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

export function DashboardHome() {
  const { activeOrganization, hasPermission } = useActiveOrganization()
  const organizationId = activeOrganization?.id ?? ''
  const enabled = organizationId !== ''
  const canReadCourses = hasPermission(permissions.COURSES_READ)
  const canReadUsage = hasPermission(permissions.AI_PROVIDERS_READ)
  const profile = trpc.user.getProfile.useQuery()
  const courses = trpc.dashboard.courses.useQuery({ organizationId }, { enabled: enabled && canReadCourses })
  const usage = trpc.dashboard.usage.useQuery({ organizationId, days: 30 }, { enabled: enabled && canReadUsage })

  if (!activeOrganization) return <Skeleton className="h-64 w-full" />
  const firstName = profile.data?.name?.split(' ')[0]

  return (
    <div className="@container/main flex flex-col gap-4 md:gap-6">
      <PageHeading
        title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        description={`Here is what is happening in ${activeOrganization.name}.`}
        actions={
          hasPermission(permissions.COURSES_CREATE) ? (
            <Link href="/dashboard/courses/new" className={buttonVariants()}>
              <PlusIcon className="size-4" />
              New course
            </Link>
          ) : null
        }
      />

      <SetupStepsCard organizationId={organizationId} />

      {canReadCourses ? (
        courses.data ? <SectionCards courses={courses.data} usage={canReadUsage ? (usage.data ?? null) : null} /> : <SectionCardsSkeleton />
      ) : null}

      {canReadUsage ? <UsageChart organizationId={organizationId} /> : null}

      <OverviewTables
        organizationId={organizationId}
        courses={canReadCourses ? (courses.data ?? null) : null}
        showActivity={hasPermission(permissions.GENERATION_JOBS_READ)}
        showModels={canReadUsage}
      />
    </div>
  )
}
