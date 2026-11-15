import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: generationLifecycle, createGenerationJob,
 *   recordTaskSuccess, recordTaskFailure, recordTaskCancelled,
 *   finalizeJobIfSettled, cancelGenerationJob, retryFailedTask,
 *   markJobStarted, retryDelayMs, exponential backoff
 *
 * WHAT:  The state machine for generation jobs and their task DAG:
 *        create → run → (succeed | retry with backoff | fail + skip dependents)
 *        → finalise (+ completion hook) — plus user-driven cancel and retry.
 * WHY:   One place owns every status transition so the worker, the routers,
 *        and crash recovery cannot disagree. Rules:
 *          • counters and cost are RECOMPUTED from rows / the cost ledger,
 *            never incremented, so concurrent workers can't drift them;
 *          • a job is finalised by a compare-and-set (transitionJob), so when
 *            two tasks finish together exactly one runs the completion hook;
 *          • a terminally failed task SKIPS its transitive dependents, while
 *            independent branches (other lessons) keep running;
 *          • retry restores the failed task and un-skips its dependents.
 *        Functions taking `db` run inside the caller's transaction (routers);
 *        worker-side functions open their own short transactions. No AI call
 *        ever happens inside a transaction.
 * WHERE: Routers (createGenerationJob, cancelGenerationJob, retryFailedTask)
 *        and the worker (markJobStarted, recordTask*, finalizeJobIfSettled,
 *        recoverStaleTasks).
 */

import { JobStatus, TaskStatus } from '@/generated/prisma'
import { prisma, type DbClient } from '@/lib/config'
import { ACTIVE_TASK_STATUSES, type NewGenerationJob, type SettledJob } from '@/lib/types'
import * as generationService from '@/services/generation.service'
import { collectDependentKeys, findUnblockedKeys, validateTaskGraph } from './dag'
import { JOB_COMPLETION_HOOKS } from './hooks'

const DEFAULT_MAX_ATTEMPTS = 3
const BACKOFF_BASE_MS = 5_000
const BACKOFF_MAX_MS = 5 * 60_000

const LIVE_JOB_STATUSES: readonly JobStatus[] = [JobStatus.QUEUED, JobStatus.RUNNING]

/**
 * SOURCE OF TRUTH KEYWORDS: retryDelayMs
 *
 * WHAT:  Exponential backoff with jitter: 5 s, 10 s, 20 s … capped at 5 min.
 * WHY:   Jitter spreads retries from parallel lessons that hit the same
 *        provider rate limit at the same moment.
 */
export function retryDelayMs(attempt: number): number {
  const exponential = Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_MAX_MS)
  return exponential + Math.floor(Math.random() * 1_000 * Math.max(1, attempt))
}

/**
 * SOURCE OF TRUTH KEYWORDS: createGenerationJob
 *
 * WHAT:  Validates and writes a job and its whole DAG. Root tasks start
 *        READY, the rest BLOCKED. Call inside the router's transaction so a
 *        rolled-back request never leaves a phantom job.
 */
export async function createGenerationJob(db: DbClient, spec: NewGenerationJob) {
  validateTaskGraph(spec.tasks)
  const job = await generationService.createJob(db, {
    organizationId: spec.organizationId,
    courseId: spec.courseId,
    createdById: spec.createdById,
    kind: spec.kind,
    status: JobStatus.QUEUED,
    ...(spec.scope !== null ? { scope: spec.scope } : {}),
    totalTasks: spec.tasks.length,
  })
  await generationService.createTasks(
    db,
    spec.tasks.map((task) => ({
      organizationId: spec.organizationId,
      jobId: job.id,
      key: task.key,
      agentId: task.agentId,
      dependsOn: [...task.dependsOn],
      input: task.input,
      maxAttempts: task.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      status: task.dependsOn.length === 0 ? TaskStatus.READY : TaskStatus.BLOCKED,
    }))
  )
  return job
}

/** QUEUED → RUNNING the first time any of its tasks is picked up. */
export async function markJobStarted(jobId: string): Promise<void> {
  await generationService.transitionJob(prisma, jobId, [JobStatus.QUEUED], {
    status: JobStatus.RUNNING,
    startedAt: new Date(),
  })
}

/* Counters and cost are derived from rows, never incremented. */
async function refreshJobProgress(db: DbClient, jobId: string): Promise<void> {
  const [counts, cost] = await Promise.all([
    generationService.countTasksByStatus(db, jobId),
    generationService.sumUsageCost(db, { jobId }),
  ])
  const count = (status: TaskStatus) => counts.find((c) => c.status === status)?._count._all ?? 0
  await generationService.updateJob(db, jobId, {
    completedTasks: count(TaskStatus.SUCCEEDED),
    failedTasks: count(TaskStatus.FAILED),
    costMicros: cost,
  })
}

async function refreshTaskCost(db: DbClient, jobId: string, taskId: string): Promise<void> {
  const cost = await generationService.sumUsageCost(db, { jobId, taskId })
  await generationService.updateTask(db, taskId, { costMicros: cost })
}

/**
 * SOURCE OF TRUTH KEYWORDS: recordTaskSuccess
 *
 * WHAT:  Marks a task SUCCEEDED, releases dependents whose deps are now all
 *        met, refreshes cost/progress, then tries to finalise the job.
 */
export async function recordTaskSuccess(task: { id: string; jobId: string }, output: unknown): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await generationService.updateTask(tx, task.id, {
      status: TaskStatus.SUCCEEDED,
      output: output ?? {},
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      error: null,
      errorKind: null,
    })
    const graph = await generationService.listJobTaskGraph(tx, task.jobId)
    await generationService.setTaskStatuses(tx, task.jobId, findUnblockedKeys(graph), [TaskStatus.BLOCKED], {
      status: TaskStatus.READY,
      runAfter: new Date(),
    })
    await refreshTaskCost(tx, task.jobId, task.id)
    await refreshJobProgress(tx, task.jobId)
  })
  await finalizeJobIfSettled(task.jobId)
}

/**
 * SOURCE OF TRUTH KEYWORDS: recordTaskFailure
 *
 * WHAT:  Retryable + attempts left → back to READY after backoff. Otherwise
 *        FAILED, transitive dependents SKIPPED, then try to finalise.
 */
export async function recordTaskFailure(
  task: { id: string; jobId: string; key: string; attempt: number; maxAttempts: number },
  failure: { message: string; kind: string; retryable: boolean }
): Promise<'retrying' | 'failed'> {
  const message = failure.message.slice(0, 2_000)

  if (failure.retryable && task.attempt < task.maxAttempts) {
    await generationService.updateTask(prisma, task.id, {
      status: TaskStatus.READY,
      runAfter: new Date(Date.now() + retryDelayMs(task.attempt)),
      lockedAt: null,
      lockedBy: null,
      error: message,
      errorKind: failure.kind,
    })
    await refreshTaskCost(prisma, task.jobId, task.id)
    return 'retrying'
  }

  await prisma.$transaction(async (tx) => {
    await generationService.updateTask(tx, task.id, {
      status: TaskStatus.FAILED,
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
      error: message,
      errorKind: failure.kind,
    })
    await skipDependents(tx, task.jobId, [task.key])
    await refreshTaskCost(tx, task.jobId, task.id)
    await refreshJobProgress(tx, task.jobId)
  })
  await finalizeJobIfSettled(task.jobId)
  return 'failed'
}

/** The job was cancelled mid-run: discard the work, close the task. */
export async function recordTaskCancelled(task: { id: string; jobId: string }): Promise<void> {
  await generationService.updateTask(prisma, task.id, {
    status: TaskStatus.CANCELLED,
    finishedAt: new Date(),
    lockedAt: null,
    lockedBy: null,
  })
  await refreshTaskCost(prisma, task.jobId, task.id)
}

async function skipDependents(db: DbClient, jobId: string, failedKeys: readonly string[]): Promise<void> {
  const graph = await generationService.listJobTaskGraph(db, jobId)
  await generationService.setTaskStatuses(db, jobId, collectDependentKeys(graph, failedKeys), [TaskStatus.BLOCKED], {
    status: TaskStatus.SKIPPED,
    finishedAt: new Date(),
  })
}

function toSettledJob(job: SettledJob): SettledJob {
  return {
    id: job.id,
    kind: job.kind,
    organizationId: job.organizationId,
    courseId: job.courseId,
    createdById: job.createdById,
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: finalizeJobIfSettled
 *
 * WHAT:  When no task is BLOCKED/READY/RUNNING, closes the job: FAILED if
 *        any task failed, else SUCCEEDED (or whatever the kind's onSucceeded
 *        hook returns, e.g. AWAITING_APPROVAL). A hook that throws fails the
 *        job with its message instead of leaving it half-closed.
 */
export async function finalizeJobIfSettled(jobId: string): Promise<void> {
  /* Recount AFTER the caller's transaction committed: two tasks settling
   * concurrently each counted inside their own tx and could not see the
   * other's write, so the in-tx counters can lag by one. */
  await refreshJobProgress(prisma, jobId)
  const counts = await generationService.countTasksByStatus(prisma, jobId)
  if (counts.some((c) => ACTIVE_TASK_STATUSES.includes(c.status) && c._count._all > 0)) return

  const job = await generationService.findJobById(prisma, jobId)
  if (!job) return
  const settled = toSettledJob(job)
  const hooks = JOB_COMPLETION_HOOKS[job.kind]
  const failed = counts.find((c) => c.status === TaskStatus.FAILED)?._count._all ?? 0

  if (failed > 0) {
    const won = await generationService.transitionJob(prisma, jobId, LIVE_JOB_STATUSES, {
      status: JobStatus.FAILED,
      finishedAt: new Date(),
      error: `${failed} task${failed === 1 ? '' : 's'} failed. Fix the cause and retry them.`,
    })
    if (won.count === 1 && hooks?.onFailed) await hooks.onFailed(prisma, settled)
    return
  }

  const won = await generationService.transitionJob(prisma, jobId, LIVE_JOB_STATUSES, {
    status: JobStatus.SUCCEEDED,
    finishedAt: new Date(),
    error: null,
  })
  if (won.count !== 1 || !hooks?.onSucceeded) return
  try {
    const next = await hooks.onSucceeded(prisma, settled)
    if (next && next !== JobStatus.SUCCEEDED) await generationService.updateJob(prisma, jobId, { status: next })
  } catch (error) {
    await generationService.updateJob(prisma, jobId, {
      status: JobStatus.FAILED,
      error: error instanceof Error ? error.message.slice(0, 2_000) : 'Completion step failed.',
    })
    if (hooks.onFailed) await hooks.onFailed(prisma, settled)
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: cancelGenerationJob
 *
 * WHAT:  Cancels a live job: pending tasks → CANCELLED. A task already
 *        RUNNING finishes its model call, then the worker discards its output
 *        (the agent checks job status before persisting). Router-side, in tx.
 * RETURNS null when the job is not in a cancellable state.
 */
export async function cancelGenerationJob(db: DbClient, jobId: string) {
  const won = await generationService.transitionJob(db, jobId, [...LIVE_JOB_STATUSES, JobStatus.AWAITING_APPROVAL], {
    status: JobStatus.CANCELLED,
    finishedAt: new Date(),
  })
  if (won.count !== 1) return null
  const graph = await generationService.listJobTaskGraph(db, jobId)
  await generationService.setTaskStatuses(
    db,
    jobId,
    graph.map((t) => t.key),
    [TaskStatus.BLOCKED, TaskStatus.READY],
    { status: TaskStatus.CANCELLED, finishedAt: new Date() }
  )
  const job = await generationService.findJobById(db, jobId)
  const onCancelled = job ? JOB_COMPLETION_HOOKS[job.kind]?.onCancelled : undefined
  if (job && onCancelled) await onCancelled(db, toSettledJob(job))
  return { id: jobId }
}

/**
 * SOURCE OF TRUTH KEYWORDS: retryFailedTask
 *
 * WHAT:  User retry of a FAILED task: attempts reset, its SKIPPED dependents
 *        un-skipped, the job reopened. Router-side, in tx.
 * RETURNS null when the task is not FAILED or its job was cancelled.
 */
export async function retryFailedTask(db: DbClient, task: { id: string; jobId: string; key: string }) {
  const job = await generationService.findJobById(db, task.jobId)
  if (!job || job.status === JobStatus.CANCELLED) return null

  const reset = await generationService.setTaskStatuses(db, task.jobId, [task.key], [TaskStatus.FAILED], {
    status: TaskStatus.READY,
    attempt: 0,
    runAfter: new Date(),
    error: null,
    errorKind: null,
    finishedAt: null,
  })
  if (reset.count !== 1) return null

  const graph = await generationService.listJobTaskGraph(db, task.jobId)
  await generationService.setTaskStatuses(db, task.jobId, collectDependentKeys(graph, [task.key]), [TaskStatus.SKIPPED], {
    status: TaskStatus.BLOCKED,
    finishedAt: null,
  })
  await generationService.updateJob(db, task.jobId, { status: JobStatus.RUNNING, finishedAt: null, error: null })
  await refreshJobProgress(db, task.jobId)
  const onReopened = JOB_COMPLETION_HOOKS[job.kind]?.onReopened
  if (onReopened) await onReopened(db, toSettledJob(job))
  return { id: task.id, jobId: task.jobId }
}

/**
 * SOURCE OF TRUTH KEYWORDS: recoverStaleTasks
 *
 * WHAT:  Crash recovery: RUNNING tasks whose lock is older than the stale
 *        window are re-queued (attempts left) or failed (exhausted); jobs of
 *        failed ones get dependents skipped and are finalised.
 */
export async function recoverStaleTasks(staleAfterSeconds: number): Promise<{ requeued: number; failed: number }> {
  const requeued = await generationService.reclaimStaleTasks(prisma, staleAfterSeconds)
  const exhausted = await generationService.failExhaustedStaleTasks(prisma, staleAfterSeconds)
  for (const jobId of new Set(exhausted.map((t) => t.jobId))) {
    const graph = await generationService.listJobTaskGraph(prisma, jobId)
    const failedKeys = graph.filter((t) => exhausted.some((e) => e.id === t.id)).map((t) => t.key)
    await prisma.$transaction(async (tx) => {
      await skipDependents(tx, jobId, failedKeys)
      await refreshJobProgress(tx, jobId)
    })
    await finalizeJobIfSettled(jobId)
  }
  return { requeued, failed: exhausted.length }
}
