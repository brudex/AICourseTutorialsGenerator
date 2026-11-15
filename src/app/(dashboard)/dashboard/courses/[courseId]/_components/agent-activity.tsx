'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: AgentActivity, Agent Activity panel, job progress,
 *   task status, cancel job, retry task, live cost
 *
 * WHAT:  Live view of a generation job (blueprint §31): one row per agent
 *        with progress ("Lesson Writer 26 / 32"), failed steps listed with
 *        Retry, total AI cost, and Cancel.
 * WHY:   Polls generationJobs.get every 2 s only while the job is live, then
 *        stops and refreshes the course so the new curriculum appears.
 *        Failed steps show plain words and what to do next
 *        (describeTaskFailure, keyed on the error kind); the precise technical
 *        reason stays one click away under "Details" for support.
 * WHERE: Course workspace.
 */

import * as React from 'react'
import Link from 'next/link'
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleIcon,
  Loader2Icon,
  MinusCircleIcon,
  RotateCcwIcon,
  XCircleIcon,
} from 'lucide-react'

import { useOnlineStatus } from '@/hooks/use-online-status'
import { OFFLINE_ACTION_HINT } from '@/components/global/connection-status'
import { trpc } from '@/trpc/react-provider'
import { useActiveOrganization } from '@/hooks/use-active-organization'
import { permissions } from '@/lib/permissions'
import { formatCostMicros } from '@/lib/ai/cost'
import type { JobStatus, TaskStatus } from '@/generated/prisma'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { GenerationTaskRow } from '@/lib/types'
import { describeTaskFailure } from '@/lib/generation/task-failure'

const LIVE: readonly JobStatus[] = ['QUEUED', 'RUNNING']

const JOB_LABELS: Record<JobStatus, string> = {
  QUEUED: 'Waiting for a worker',
  RUNNING: 'Running',
  AWAITING_APPROVAL: 'Waiting for your approval',
  SUCCEEDED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
}

function TaskIcon({ status }: { status: TaskStatus }) {
  switch (status) {
    case 'SUCCEEDED':
      return <CheckCircle2Icon className="size-4 text-foreground" />
    case 'RUNNING':
      return <Loader2Icon className="size-4 animate-spin text-foreground" />
    case 'READY':
      return <CircleIcon className="size-4 text-muted-foreground" />
    case 'FAILED':
      return <XCircleIcon className="size-4 text-destructive" />
    case 'SKIPPED':
    case 'CANCELLED':
      return <MinusCircleIcon className="size-4 text-muted-foreground" />
    default:
      return <CircleDashedIcon className="size-4 text-muted-foreground" />
  }
}

function taskDetail(task: GenerationTaskRow): string {
  switch (task.status) {
    case 'RUNNING':
      return task.attempt > 1 ? `Working, attempt ${task.attempt} of ${task.maxAttempts}` : 'Working…'
    case 'READY':
      return task.error ? `Retrying soon. ${describeTaskFailure(task).summary}` : 'Up next'
    case 'BLOCKED':
      return 'Waiting for earlier steps'
    case 'SUCCEEDED':
      return 'Done'
    case 'SKIPPED':
      return 'Skipped because an earlier step failed'
    case 'CANCELLED':
      return 'Cancelled'
    case 'FAILED':
      return describeTaskFailure(task).summary
  }
}

interface AgentGroup {
  agentName: string
  tasks: GenerationTaskRow[]
  done: number
  status: TaskStatus
}

/* One row per agent (blueprint §31): "Lesson Writer 26 / 32". The group's
 * icon reflects the most important state: failed > running > ready/blocked >
 * finished. */
function groupByAgent(tasks: readonly GenerationTaskRow[]): AgentGroup[] {
  const groups = new Map<string, GenerationTaskRow[]>()
  for (const task of tasks) {
    const list = groups.get(task.agentName)
    if (list) list.push(task)
    else groups.set(task.agentName, [task])
  }
  return [...groups.entries()].map(([agentName, list]) => {
    const has = (status: TaskStatus) => list.some((t) => t.status === status)
    const status: TaskStatus = has('FAILED')
      ? 'FAILED'
      : has('RUNNING')
        ? 'RUNNING'
        : has('READY')
          ? 'READY'
          : has('BLOCKED')
            ? 'BLOCKED'
            : list.every((t) => t.status === 'SUCCEEDED')
              ? 'SUCCEEDED'
              : (list[0]?.status ?? 'SKIPPED')
    return { agentName, tasks: list, done: list.filter((t) => t.status === 'SUCCEEDED').length, status }
  })
}

function groupDetail(group: AgentGroup): string {
  const running = group.tasks.filter((t) => t.status === 'RUNNING').length
  const failed = group.tasks.filter((t) => t.status === 'FAILED').length
  if (failed > 0) return `${failed} failed, see below`
  if (running > 0) return `Working on ${running}…`
  if (group.status === 'SUCCEEDED') return 'All done'
  if (group.status === 'BLOCKED') return 'Waiting for earlier steps'
  return 'Up next'
}

export function AgentActivity({
  organizationId,
  jobId,
  onSettled,
}: {
  organizationId: string
  jobId: string
  onSettled: () => void
}) {
  const { hasPermission } = useActiveOrganization()
  const utils = trpc.useUtils()
  const jobQuery = trpc.generationJobs.get.useQuery(
    { organizationId, id: jobId },
    {
      refetchInterval: (query) => {
        const status = query.state.data?.status
        return status === undefined || LIVE.includes(status) ? 2_000 : false
      },
    }
  )
  const cancel = trpc.generationJobs.cancel.useMutation()
  const retry = trpc.generationJobs.retry.useMutation()
  const online = useOnlineStatus()
  const [error, setError] = React.useState<string | null>(null)

  const job = jobQuery.data
  const live = job ? LIVE.includes(job.status) : true

  /* Refresh the course once, when the job leaves a live state. A ref (not
   * state) tracks the previous status so no extra render is triggered. */
  const previousStatus = React.useRef<JobStatus | null>(null)
  const status = job?.status ?? null
  React.useEffect(() => {
    const was = previousStatus.current
    previousStatus.current = status
    if (was !== null && status !== null && LIVE.includes(was) && !LIVE.includes(status)) onSettled()
  }, [status, onSettled])

  async function act(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      await utils.generationJobs.get.invalidate({ organizationId, id: jobId })
      onSettled()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    }
  }

  if (!job) return null

  const failedTasks = job.tasks.filter((t) => t.status === 'FAILED')
  const configError = failedTasks.some((t) => t.errorKind === 'not_configured' || t.errorKind === 'auth')

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              Agent activity
              <Badge variant={job.status === 'FAILED' ? 'destructive' : 'outline'}>{JOB_LABELS[job.status]}</Badge>
            </CardTitle>
            <CardDescription>
              {job.completedTasks} of {job.totalTasks} steps done · AI usage {formatCostMicros(job.costMicros)}
            </CardDescription>
          </div>
          {live && hasPermission(permissions.GENERATION_JOBS_CANCEL) ? (
            <Button
              variant="outline"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => void act(() => cancel.mutateAsync({ organizationId, id: jobId }))}
            >
              Cancel
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-3">
          {groupByAgent(job.tasks).map((group) => {
            const single = group.tasks.length === 1 ? group.tasks[0] : undefined
            return (
              <li key={group.agentName} className="flex items-start gap-3">
                <span className="mt-0.5">
                  <TaskIcon status={group.status} />
                </span>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-medium">
                    {group.agentName}
                    {single ? null : (
                      <span className="ml-2 font-normal text-muted-foreground">
                        {group.done} / {group.tasks.length}
                      </span>
                    )}
                  </p>
                  <p className={group.status === 'FAILED' ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
                    {single ? taskDetail(single) : groupDetail(group)}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
        {failedTasks.length > 0 ? (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">Failed steps</p>
            <ul className="space-y-2">
              {failedTasks.map((task) => {
                const failure = describeTaskFailure(task)
                return (
                  <li key={task.id} className="flex items-start gap-3">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-xs font-medium">{task.agentName}</p>
                      <p className="text-xs text-destructive">{failure.summary}</p>
                      {failure.action ? <p className="text-xs text-muted-foreground">{failure.action}</p> : null}
                      {failure.technical && task.error ? (
                        <details className="text-xs text-muted-foreground">
                          <summary className="w-fit cursor-pointer underline-offset-4 hover:underline">Details</summary>
                          <p className="mt-1 break-words rounded-md bg-muted/50 px-2 py-1.5 font-mono text-[11px]">{task.error}</p>
                        </details>
                      ) : null}
                    </div>
                    {hasPermission(permissions.GENERATION_JOBS_RETRY) ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={retry.isPending || !online}
                        title={online ? undefined : OFFLINE_ACTION_HINT}
                        onClick={() => void act(() => retry.mutateAsync({ organizationId, taskId: task.id }))}
                      >
                        <RotateCcwIcon className="size-3.5" />
                        Retry
                      </Button>
                    ) : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ) : null}
        {configError ? (
          <p className="text-xs text-muted-foreground">
            Check your keys and model routing in{' '}
            <Link href="/dashboard/settings/ai-providers" className="underline underline-offset-4">
              Settings → AI Providers
            </Link>
            , then retry.
          </p>
        ) : null}
        {job.status === 'QUEUED' ? (
          <p className="text-xs text-muted-foreground">
            Nothing picking this up? Make sure the worker is running (<code>npm run worker</code>).
          </p>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  )
}
