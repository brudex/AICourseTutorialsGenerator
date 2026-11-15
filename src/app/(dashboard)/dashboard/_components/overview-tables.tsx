'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: OverviewTables, dashboard tables, recent courses
 *   table, agent activity table, models table, tabbed data table
 *
 * WHAT:  The tabbed table under the chart (shadcn dashboard-01 data table):
 *        Recent courses, Agent activity and Models, each rendered with the
 *        global DataTable.
 * WHY:   One card with tabs keeps the page compact and scannable; each tab
 *        appears only when the member may read its data. Course and job rows
 *        open the course. The activity tab refreshes every 5 seconds while a
 *        job is running.
 * WHERE: DashboardHome.
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { CheckCircle2Icon, CircleDashedIcon, Loader2Icon, PauseCircleIcon, XCircleIcon, type LucideIcon } from 'lucide-react'

import type { JobStatus } from '@/generated/prisma'
import { trpc } from '@/trpc/react-provider'
import { JOB_KIND_LABELS, JOB_STATUS_LABELS } from '@/lib/config'
import type { DashboardActivity, DashboardCourses, DashboardUsage } from '@/lib/types'
import { cn } from '@/lib/utils'
import { DataTable, type DataTableColumn } from '@/components/global/data-table'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CourseStatusBadge } from '../courses/_components/course-status-badge'

type CourseRow = DashboardCourses['recent'][number]
type JobRow = DashboardActivity['recent'][number]
type ModelRow = DashboardUsage['models'][number]

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

const STATUS_ICONS: Record<JobStatus, { icon: LucideIcon; className: string }> = {
  QUEUED: { icon: CircleDashedIcon, className: 'text-muted-foreground' },
  RUNNING: { icon: Loader2Icon, className: 'animate-spin' },
  AWAITING_APPROVAL: { icon: PauseCircleIcon, className: '' },
  SUCCEEDED: { icon: CheckCircle2Icon, className: 'text-success' },
  FAILED: { icon: XCircleIcon, className: 'text-destructive' },
  CANCELLED: { icon: XCircleIcon, className: 'text-muted-foreground' },
}

function Progress({ value, total }: { value: number; total: number }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="flex min-w-32 items-center gap-2">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
      <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
        {value}/{total}
      </span>
    </div>
  )
}

const COURSE_COLUMNS: ReadonlyArray<DataTableColumn<CourseRow>> = [
  { id: 'title', header: 'Course', cell: (row) => <span className="font-medium">{row.title}</span> },
  { id: 'status', header: 'Status', cell: (row) => <CourseStatusBadge status={row.status} approved={row.approved} /> },
  { id: 'progress', header: 'Lectures written', hideBelow: 'md', cell: (row) => <Progress value={row.written} total={row.lessons} /> },
  {
    id: 'updated',
    header: 'Updated',
    hideBelow: 'lg',
    align: 'right',
    cell: (row) => <span className="text-muted-foreground">{formatDistanceToNow(row.updatedAt, { addSuffix: true })}</span>,
  },
]

const JOB_COLUMNS: ReadonlyArray<DataTableColumn<JobRow>> = [
  {
    id: 'job',
    header: 'Job',
    cell: (row) => {
      const { icon: Icon, className } = STATUS_ICONS[row.status]
      return (
        <span className="flex items-center gap-2 font-medium">
          <Icon className={cn('size-4 shrink-0', className)} />
          {JOB_KIND_LABELS[row.kind]}
        </span>
      )
    },
  },
  { id: 'course', header: 'Course', hideBelow: 'md', cell: (row) => <span className="text-muted-foreground">{row.course.title}</span> },
  {
    id: 'tasks',
    header: 'Tasks',
    hideBelow: 'sm',
    cell: (row) => <Progress value={row.completedTasks + row.failedTasks} total={row.totalTasks} />,
  },
  {
    id: 'status',
    header: 'Status',
    cell: (row) => (
      <Badge variant={row.status === 'FAILED' ? 'destructive' : 'outline'} className="text-muted-foreground">
        {JOB_STATUS_LABELS[row.status]}
      </Badge>
    ),
  },
  {
    id: 'when',
    header: 'When',
    hideBelow: 'lg',
    align: 'right',
    cell: (row) => <span className="text-muted-foreground">{formatDistanceToNow(row.finishedAt ?? row.createdAt, { addSuffix: true })}</span>,
  },
]

function modelColumns(maxTokens: number): ReadonlyArray<DataTableColumn<ModelRow>> {
  return [
    { id: 'model', header: 'Model', cell: (row) => <span className="font-medium">{row.model}</span> },
    { id: 'calls', header: 'Calls', align: 'right', cell: (row) => <span className="tabular-nums">{row.calls}</span> },
    { id: 'tokens', header: 'Tokens', align: 'right', cell: (row) => <span className="tabular-nums">{compact.format(row.tokens)}</span> },
    {
      id: 'share',
      header: 'Share of tokens',
      hideBelow: 'md',
      cell: (row) => (
        <div className="h-1.5 w-full min-w-32 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className="h-full rounded-full bg-chart-1" style={{ width: `${(row.tokens / Math.max(1, maxTokens)) * 100}%` }} />
        </div>
      ),
    },
  ]
}

interface OverviewTablesProps {
  organizationId: string
  courses: DashboardCourses | null
  showActivity: boolean
  showModels: boolean
}

export function OverviewTables({ organizationId, courses, showActivity, showModels }: OverviewTablesProps) {
  const router = useRouter()
  const activity = trpc.dashboard.activity.useQuery(
    { organizationId },
    { enabled: showActivity, refetchInterval: (query) => ((query.state.data?.running ?? 0) > 0 ? 5_000 : false) }
  )
  const usage = trpc.dashboard.usage.useQuery({ organizationId, days: 30 }, { enabled: showModels })
  const tabs = [courses ? 'courses' : null, showActivity ? 'activity' : null, showModels ? 'models' : null].filter(
    (tab): tab is string => tab !== null
  )
  const [tab, setTab] = React.useState(tabs[0] ?? 'courses')
  if (tabs.length === 0) return null
  const models = usage.data?.models ?? []
  const running = activity.data?.running ?? 0

  return (
    <Tabs value={tab} onValueChange={(value: string) => setTab(value)} className="gap-4">
      <TabsList>
        {courses ? <TabsTrigger value="courses">Recent courses</TabsTrigger> : null}
        {showActivity ? (
          <TabsTrigger value="activity" className="gap-1.5">
            Agent activity
            {running > 0 ? <Badge variant="secondary" className="h-5 px-1.5">{running}</Badge> : null}
          </TabsTrigger>
        ) : null}
        {showModels ? <TabsTrigger value="models">Models</TabsTrigger> : null}
      </TabsList>
      {courses ? (
        <TabsContent value="courses">
          <DataTable
            columns={COURSE_COLUMNS}
            rows={courses.recent}
            rowKey={(row) => row.id}
            onRowClick={(row) => router.push(`/dashboard/courses/${row.id}`)}
            empty={<p className="text-sm text-muted-foreground">No courses yet.</p>}
          />
        </TabsContent>
      ) : null}
      {showActivity ? (
        <TabsContent value="activity">
          <DataTable
            columns={JOB_COLUMNS}
            rows={activity.data?.recent ?? []}
            rowKey={(row) => row.id}
            isLoading={activity.isLoading}
            onRowClick={(row) => router.push(`/dashboard/courses/${row.course.id}`)}
            empty={<p className="text-sm text-muted-foreground">No agent work yet.</p>}
          />
        </TabsContent>
      ) : null}
      {showModels ? (
        <TabsContent value="models">
          <DataTable
            columns={modelColumns(models[0]?.tokens ?? 0)}
            rows={models}
            rowKey={(row) => row.model}
            isLoading={usage.isLoading}
            empty={<p className="text-sm text-muted-foreground">No model calls in the last 30 days.</p>}
          />
        </TabsContent>
      ) : null}
    </Tabs>
  )
}
