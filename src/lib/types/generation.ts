/**
 * SOURCE OF TRUTH KEYWORDS: GenerationTypes, AgentTaskSpec, NewGenerationJob,
 *   AgentExecutionContext, AgentExecutionResult, AgentDefinition,
 *   generationJobIdSchema, retryAgentTaskSchema, TERMINAL_TASK_STATUSES
 *
 * WHAT:  Contracts for the generation engine: how a job's task DAG is
 *        described, what an agent receives and returns, and the router
 *        inputs for the Agent Activity screen.
 * WHY:   Shared by the web app (routers create jobs, read progress) and the
 *        worker process (runs tasks) — one definition keeps them in lockstep.
 *        AgentDefinition is deliberately non-generic at the registry level:
 *        each agent's typed input/output lives inside its `execute` closure
 *        (built by defineAgent), so the registry never fights generic variance.
 *        Enums come from the generated Prisma client.
 * WHERE: src/lib/generation/*, src/lib/agents/*, src/worker/*,
 *        src/trpc/routers/generation-jobs.ts. Re-exported via src/lib/types.
 */

import { z } from 'zod'

import { TaskStatus } from '@/generated/prisma'
import type { AiCapability, AiUsageEvent, JobKind, JobStatus, Prisma } from '@/generated/prisma'
import type { DbClient } from '@/lib/config/prisma'
import type { ChatMessage } from './ai'

/**
 * SOURCE OF TRUTH KEYWORDS: AgentTaskSpec, NewGenerationJob
 *
 * WHAT:  One node of a job's DAG before it is written, and the job it
 *        belongs to. `dependsOn` lists sibling `key`s.
 * WHERE: Built by job DAG builders; written by createGenerationJob
 *        (src/lib/generation/jobs.ts).
 */
export interface AgentTaskSpec {
  key: string
  agentId: string
  dependsOn: readonly string[]
  input: Prisma.InputJsonValue
  maxAttempts?: number
}

export interface NewGenerationJob {
  organizationId: string
  courseId: string
  createdById: string | null
  kind: JobKind
  scope: Prisma.InputJsonValue | null
  tasks: readonly AgentTaskSpec[]
}

/**
 * SOURCE OF TRUTH KEYWORDS: AgentExecutionContext
 *
 * WHAT:  What the worker hands an agent: a DB client (plain, NOT a
 *        transaction — agents call models for minutes), the claimed task, and
 *        its job's identity.
 */
export interface AgentExecutionContext {
  db: DbClient
  task: { id: string; key: string; agentId: string; attempt: number; input: Prisma.JsonValue }
  job: { id: string; kind: JobKind; organizationId: string; courseId: string; createdById: string | null }
}

/**
 * SOURCE OF TRUTH KEYWORDS: AgentExecutionResult
 *
 * WHAT:  What an agent returns: a small JSON summary stored on
 *        AgentTask.output (counts, ids, QA verdict) — NOT the full content,
 *        which the agent has already persisted to Course State.
 */
export interface AgentExecutionResult {
  output: Prisma.InputJsonValue
}

/**
 * SOURCE OF TRUTH KEYWORDS: AgentDefinition, AgentRegistryEntry
 *
 * WHAT:  A registry entry: display name, default capability, and `execute`.
 */
export interface AgentDefinition {
  name: string
  description: string
  capability: AiCapability
  execute: (context: AgentExecutionContext) => Promise<AgentExecutionResult>
}

/**
 * SOURCE OF TRUTH KEYWORDS: AgentConfig, defineAgent, AgentPersistArgs
 *
 * WHAT:  The typed recipe for one agent, turned into an AgentDefinition by
 *        defineAgent (src/lib/agents/define-agent.ts):
 *          inputSchema   — validates AgentTask.input (ids, never content)
 *          loadContext   — reads current Course State at run time
 *          buildMessages — the prompt
 *          outputSchema  — the model's structured-output contract
 *          persist       — writes Course State (inside a transaction) and
 *                          returns the small summary stored on the task
 * WHY:   Every agent gets validation, routing, cancellation checks, and
 *        transactional persistence identically; an agent file only states
 *        what is specific to it.
 */
export interface AgentPersistArgs<I, O, C> {
  input: I
  output: O
  context: C
  execution: AgentExecutionContext
}

export interface AgentConfig<I, O, C> {
  name: string
  description: string
  capability: AiCapability
  inputSchema: z.ZodType<I>
  outputSchema: z.ZodType<O>
  schemaName: string
  temperature?: number
  maxOutputTokens?: number
  loadContext: (db: DbClient, input: I, job: AgentExecutionContext['job']) => Promise<C>
  /** Optional per-run capability override (e.g. CODING for programming courses). */
  resolveCapability?: (context: C) => AiCapability
  /** Attributes cost rows to a lesson when the task is lesson-scoped. */
  lessonIdOf?: (input: I) => string | null
  buildMessages: (context: C, input: I) => ChatMessage[]
  persist: (db: DbClient, args: AgentPersistArgs<I, O, C>) => Promise<Prisma.InputJsonValue>
}

/**
 * SOURCE OF TRUTH KEYWORDS: JobCompletionHooks, SettledJob
 *
 * WHAT:  Per-JobKind reactions when a job's last task settles. `onSucceeded`
 *        may return a different final status (PLAN_COURSE returns
 *        AWAITING_APPROVAL and moves the course to CURRICULUM_REVIEW);
 *        `onFailed` updates Course State (e.g. course → FAILED).
 * WHERE: Registered in src/lib/generation/hooks.ts; called by
 *        finalizeJobIfSettled.
 */
export interface SettledJob {
  id: string
  kind: JobKind
  organizationId: string
  courseId: string
  createdById: string | null
}

export interface JobCompletionHooks {
  onSucceeded?: (db: DbClient, job: SettledJob) => Promise<JobStatus | void>
  onFailed?: (db: DbClient, job: SettledJob) => Promise<void>
  /** A user retried a failed task, reopening the job. */
  onReopened?: (db: DbClient, job: SettledJob) => Promise<void>
  /** A user cancelled the job. */
  onCancelled?: (db: DbClient, job: SettledJob) => Promise<void>
}

/**
 * SOURCE OF TRUTH KEYWORDS: TERMINAL_TASK_STATUSES, ACTIVE_TASK_STATUSES
 *
 * WHAT:  Task statuses that will never change again without a user action,
 *        and the ones that mean "work still pending".
 * WHERE: Job finalisation (src/lib/generation/lifecycle.ts) and the UI.
 */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = [
  TaskStatus.SUCCEEDED,
  TaskStatus.FAILED,
  TaskStatus.SKIPPED,
  TaskStatus.CANCELLED,
]

export const ACTIVE_TASK_STATUSES: readonly TaskStatus[] = [
  TaskStatus.BLOCKED,
  TaskStatus.READY,
  TaskStatus.RUNNING,
]

/**
 * SOURCE OF TRUTH KEYWORDS: generationJobIdSchema, listCourseJobsSchema,
 *   retryAgentTaskSchema
 *
 * WHAT:  Router inputs for the Agent Activity screen.
 * WHERE: src/trpc/routers/generation-jobs.ts.
 */
export const generationJobIdSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
})

export const listCourseJobsSchema = z.object({
  organizationId: z.string().min(1),
  courseId: z.string().min(1),
})

export const retryAgentTaskSchema = z.object({
  organizationId: z.string().min(1),
  taskId: z.string().min(1),
})

export type GenerationJobIdValues = z.infer<typeof generationJobIdSchema>
export type ListCourseJobsValues = z.infer<typeof listCourseJobsSchema>
export type RetryAgentTaskValues = z.infer<typeof retryAgentTaskSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: TaskFailureDescription, friendly task error,
 *   describeTaskFailure
 *
 * WHAT:  A failed or retrying agent step explained for customers: what
 *        happened in plain words, what to do next, and whether the original
 *        technical message is worth offering behind "Details".
 * WHERE: describeTaskFailure (src/lib/generation/task-failure.ts),
 *        AgentActivity.
 */
export interface TaskFailureDescription {
  summary: string
  action: string | null
  /** True when `error` is technical and should only appear behind "Details". */
  technical: boolean
}

/**
 * SOURCE OF TRUTH KEYWORDS: TaskModelUse, TaskModelCall, model used by step,
 *   which model ran, agent step model, fallback model trace, summarizeTaskModels
 *
 * WHAT:  The AI models one agent step called, oldest first, each with the
 *        outcome of its latest call (from the AiUsageEvent ledger).
 * WHY:   When a step fails ("model not exist") the person needs to see which
 *        provider model id was tried, and in what order spare models ran,
 *        to fix the right setting.
 * WHERE: summarizeTaskModels (src/lib/generation/task-models.ts),
 *        generationJobs.get, AgentActivity.
 */
export type TaskModelCall = Pick<AiUsageEvent, 'modelName' | 'providerName' | 'success' | 'errorKind' | 'errorMessage' | 'createdAt'>

export interface TaskModelUse {
  /** The provider's own model id, e.g. "qwen-plus". */
  modelName: string
  providerName: string
  /** Outcome of this model's latest call in the step. */
  success: boolean
  errorKind: string | null
  /** What the provider said on the latest failed call (null on success or for calls logged before it was kept). */
  errorMessage: string | null
}
