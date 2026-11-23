import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: generationService, claimReadyTasks,
 *   reclaimStaleTasks, failExhaustedStaleTasks, findTaskForRun, listJobTaskGraph,
 *   setTaskStatuses, sumUsageCost, GENERATION_JOB_SELECT, AGENT_TASK_SELECT,
 *   TaskQueue, SKIP LOCKED
 *
 * WHAT:  Pure Prisma (and two raw SQL statements) for GenerationJob and
 *        AgentTask — including the work queue's atomic claim.
 * WHY:   The AgentTask table IS the queue (spec decision D1). Claiming uses
 *        `FOR UPDATE SKIP LOCKED` so any number of worker processes can poll
 *        concurrently without double-running a task; the claim and the
 *        status flip happen in ONE statement, so a crash can never leave a
 *        task locked-but-not-running. Raw SQL is used only where Prisma has
 *        no equivalent (row locking, interval arithmetic). Column names are
 *        the Prisma field names (models map tables, not columns).
 *        Everything else is one-verb Prisma; orchestration rules live in
 *        src/lib/generation.
 * WHERE: src/lib/generation/* (lifecycle), src/worker/*, and
 *        src/trpc/routers/generation-jobs.ts.
 */

import type { JobKind, JobStatus, Prisma, TaskStatus } from '@/generated/prisma'
import type { DbClient } from '@/lib/config'

/* Client-safe projections: task input/output stay server-side (they can be
 * large and are internal); the UI only needs status, timing, cost, errors. */
export const AGENT_TASK_SELECT = {
  id: true,
  key: true,
  agentId: true,
  status: true,
  dependsOn: true,
  attempt: true,
  maxAttempts: true,
  error: true,
  errorKind: true,
  runAfter: true,
  startedAt: true,
  finishedAt: true,
  costMicros: true,
  createdAt: true,
  /* The latest model calls of the step, so the UI can show which model ran (summarizeTaskModels). */
  aiUsageEvents: {
    select: { modelName: true, providerName: true, success: true, errorKind: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  },
} satisfies Prisma.AgentTaskSelect

export const GENERATION_JOB_SELECT = {
  id: true,
  courseId: true,
  kind: true,
  status: true,
  scope: true,
  totalTasks: true,
  completedTasks: true,
  failedTasks: true,
  costMicros: true,
  error: true,
  startedAt: true,
  finishedAt: true,
  createdAt: true,
} satisfies Prisma.GenerationJobSelect

// ── Creation ─────────────────────────────────────────────────────────────

export function createJob(db: DbClient, data: Prisma.GenerationJobUncheckedCreateInput) {
  return db.generationJob.create({ data, select: { id: true } })
}

export function createTasks(db: DbClient, data: Prisma.AgentTaskCreateManyInput[]) {
  return db.agentTask.createMany({ data })
}

// ── Queue ────────────────────────────────────────────────────────────────

/**
 * SOURCE OF TRUTH KEYWORDS: claimReadyTasks
 *
 * WHAT:  Atomically claims up to `limit` READY tasks whose runAfter has
 *        passed and whose job is still live; flips them to RUNNING and bumps
 *        `attempt`. Returns the claimed ids.
 */
export async function claimReadyTasks(db: DbClient, workerId: string, limit: number): Promise<string[]> {
  if (limit <= 0) return []
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE agent_task
       SET status = 'RUNNING',
           "lockedAt" = now(),
           "lockedBy" = ${workerId},
           "startedAt" = COALESCE("startedAt", now()),
           attempt = attempt + 1,
           "updatedAt" = now()
     WHERE id IN (
       SELECT t.id
         FROM agent_task t
         JOIN generation_job j ON j.id = t."jobId"
        WHERE t.status = 'READY'
          AND t."runAfter" <= now()
          AND j.status IN ('QUEUED', 'RUNNING')
        ORDER BY t."runAfter" ASC, t."createdAt" ASC
        LIMIT ${limit}
        FOR UPDATE OF t SKIP LOCKED
     )
     RETURNING id`
  return rows.map((r) => r.id)
}

/**
 * SOURCE OF TRUTH KEYWORDS: listRunningTaskLocks, expireTaskLocks, orphaned tasks
 *
 * WHAT:  RUNNING tasks whose lock was taken by workers whose id starts with a
 *        prefix (one host), and a way to expire chosen locks so the next stale
 *        sweep recovers them at once.
 * WHY:   A worker killed mid-task (deploy, crash, dev restart) leaves its
 *        tasks RUNNING; on the same host a new worker can prove the old
 *        process is gone and recover them without waiting for the timeout.
 */
export function listRunningTaskLocks(db: DbClient, lockPrefix: string) {
  return db.agentTask.findMany({
    where: { status: 'RUNNING', lockedBy: { startsWith: lockPrefix } },
    select: { id: true, lockedBy: true },
  })
}

export function expireTaskLocks(db: DbClient, taskIds: readonly string[]) {
  return db.agentTask.updateMany({ where: { id: { in: [...taskIds] }, status: 'RUNNING' }, data: { lockedAt: new Date(0) } })
}

/**
 * SOURCE OF TRUTH KEYWORDS: reclaimStaleTasks, failExhaustedStaleTasks
 *
 * WHAT:  Recovers tasks a crashed worker left RUNNING. Ones with attempts
 *        left go back to READY; exhausted ones are marked FAILED (their job
 *        ids are returned so the caller can skip dependents and finalise).
 */
export async function reclaimStaleTasks(db: DbClient, staleAfterSeconds: number): Promise<number> {
  return db.$executeRaw`
    UPDATE agent_task
       SET status = 'READY', "lockedAt" = NULL, "lockedBy" = NULL, "runAfter" = now(), "updatedAt" = now()
     WHERE status = 'RUNNING'
       AND attempt < "maxAttempts"
       AND "lockedAt" < now() - make_interval(secs => ${staleAfterSeconds})`
}

export async function failExhaustedStaleTasks(
  db: DbClient,
  staleAfterSeconds: number
): Promise<Array<{ id: string; jobId: string }>> {
  return db.$queryRaw<Array<{ id: string; jobId: string }>>`
    UPDATE agent_task
       SET status = 'FAILED', "lockedAt" = NULL, "lockedBy" = NULL, "finishedAt" = now(),
           error = 'The worker stopped while running this task and no attempts remain.',
           "errorKind" = 'timeout', "updatedAt" = now()
     WHERE status = 'RUNNING'
       AND attempt >= "maxAttempts"
       AND "lockedAt" < now() - make_interval(secs => ${staleAfterSeconds})
     RETURNING id, "jobId"`
}

// ── Task reads / writes ──────────────────────────────────────────────────

export function findTaskForRun(db: DbClient, taskId: string) {
  return db.agentTask.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      key: true,
      agentId: true,
      status: true,
      attempt: true,
      maxAttempts: true,
      input: true,
      job: {
        select: { id: true, kind: true, status: true, organizationId: true, courseId: true, createdById: true },
      },
    },
  })
}

export function findTask(db: DbClient, organizationId: string, taskId: string) {
  return db.agentTask.findFirst({
    where: { id: taskId, organizationId },
    select: { id: true, jobId: true, key: true, status: true },
  })
}

/** The whole DAG of one job, minimal columns, for dependency resolution. */
export function listJobTaskGraph(db: DbClient, jobId: string) {
  return db.agentTask.findMany({
    where: { jobId },
    select: { id: true, key: true, status: true, dependsOn: true },
  })
}

export function updateTask(db: DbClient, taskId: string, data: Prisma.AgentTaskUncheckedUpdateInput) {
  return db.agentTask.update({ where: { id: taskId }, data, select: { id: true, jobId: true } })
}

export function setTaskStatuses(
  db: DbClient,
  jobId: string,
  keys: readonly string[],
  fromStatuses: readonly TaskStatus[],
  data: Prisma.AgentTaskUncheckedUpdateManyInput
) {
  if (keys.length === 0) return Promise.resolve({ count: 0 })
  return db.agentTask.updateMany({
    where: { jobId, key: { in: [...keys] }, status: { in: [...fromStatuses] } },
    data,
  })
}

export function countTasksByStatus(db: DbClient, jobId: string) {
  return db.agentTask.groupBy({ by: ['status'], where: { jobId }, _count: { _all: true } })
}

/** Ledger total for a job or one of its tasks (includes failed attempts). */
export async function sumUsageCost(db: DbClient, where: { jobId: string; taskId?: string }): Promise<bigint> {
  const result = await db.aiUsageEvent.aggregate({ where, _sum: { costMicros: true } })
  return result._sum.costMicros ?? BigInt(0)
}

// ── Job reads / writes ───────────────────────────────────────────────────

export function findJobById(db: DbClient, jobId: string) {
  return db.generationJob.findUnique({
    where: { id: jobId },
    select: { id: true, kind: true, status: true, organizationId: true, courseId: true, createdById: true },
  })
}

/**
 * SOURCE OF TRUTH KEYWORDS: transitionJob
 *
 * WHAT:  Compare-and-set on job status: updates only if the job is currently
 *        in one of `from`. `count === 1` means this caller won the transition —
 *        how concurrent finalisers avoid running completion hooks twice.
 */
export function transitionJob(
  db: DbClient,
  jobId: string,
  from: readonly JobStatus[],
  data: Prisma.GenerationJobUncheckedUpdateManyInput
) {
  return db.generationJob.updateMany({ where: { id: jobId, status: { in: [...from] } }, data })
}

export function updateJob(db: DbClient, jobId: string, data: Prisma.GenerationJobUncheckedUpdateInput) {
  return db.generationJob.update({ where: { id: jobId }, data, select: { id: true, status: true } })
}

export function findJobWithTasks(db: DbClient, organizationId: string, jobId: string) {
  return db.generationJob.findFirst({
    where: { id: jobId, organizationId },
    select: { ...GENERATION_JOB_SELECT, tasks: { select: AGENT_TASK_SELECT, orderBy: { createdAt: 'asc' } } },
  })
}

/** Most recent job of a kind for a course (e.g. the PLAN_COURSE awaiting approval). */
export function findLatestCourseJob(db: DbClient, courseId: string, kind: JobKind) {
  return db.generationJob.findFirst({
    where: { courseId, kind },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  })
}

/** True while any job for the course is still queued or running. */
export function hasLiveCourseJob(db: DbClient, courseId: string) {
  return db.generationJob
    .count({ where: { courseId, status: { in: ['QUEUED', 'RUNNING'] } } })
    .then((n) => n > 0)
}

export function listCourseJobs(db: DbClient, organizationId: string, courseId: string) {
  return db.generationJob.findMany({
    where: { organizationId, courseId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: GENERATION_JOB_SELECT,
  })
}
