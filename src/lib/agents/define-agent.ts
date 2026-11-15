import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: defineAgent, AgentConfig, AgentDefinition,
 *   agent execution pipeline, assertJobLive, JobCancelledError
 *
 * WHAT:  Turns a typed AgentConfig into a registry AgentDefinition whose
 *        `execute` runs the standard pipeline:
 *          validate input → load Course State → prompt → AI Gateway
 *          (structured) → check the job is still live → persist in a
 *          transaction → return a small summary.
 * WHY:   The model call happens with NO transaction open; only the final
 *        write is transactional, and it re-checks job status first so a job
 *        cancelled mid-call never gets its content written. Input problems
 *        raise AgentInputError (non-retryable) — a malformed task will not
 *        succeed on attempt two.
 * WHERE: Every agent in src/lib/agents/*; executed by the worker.
 */

import { JobStatus } from '@/generated/prisma'
import { prisma, type DbClient } from '@/lib/config'
import type { AgentConfig, AgentDefinition, AgentExecutionContext } from '@/lib/types'
import { generateStructured } from '@/lib/ai'
import * as generationService from '@/services/generation.service'
import { AgentInputError, JobCancelledError } from '@/lib/generation/errors'

/** Throws JobCancelledError when the job was cancelled — check before persisting. */
export async function assertJobLive(db: DbClient, jobId: string): Promise<void> {
  const job = await generationService.findJobById(db, jobId)
  if (!job || job.status === JobStatus.CANCELLED) throw new JobCancelledError()
}

export function defineAgent<I, O, C>(config: AgentConfig<I, O, C>): AgentDefinition {
  async function execute(execution: AgentExecutionContext) {
    const parsedInput = config.inputSchema.safeParse(execution.task.input)
    if (!parsedInput.success) {
      throw new AgentInputError(`Task input for ${config.name} is invalid: ${parsedInput.error.message}`)
    }
    const input = parsedInput.data
    const context = await config.loadContext(execution.db, input, execution.job)

    const result = await generateStructured({
      context: {
        organizationId: execution.job.organizationId,
        agentId: execution.task.agentId,
        courseId: execution.job.courseId,
        lessonId: config.lessonIdOf?.(input) ?? null,
        jobId: execution.job.id,
        taskId: execution.task.id,
      },
      capability: config.resolveCapability?.(context) ?? config.capability,
      messages: config.buildMessages(context, input),
      schema: config.outputSchema,
      schemaName: config.schemaName,
      ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
      ...(config.maxOutputTokens !== undefined ? { maxOutputTokens: config.maxOutputTokens } : {}),
    })

    const output = await prisma.$transaction(
      async (tx) => {
        await assertJobLive(tx, execution.job.id)
        return config.persist(tx, { input, output: result.data, context, execution })
      },
      { timeout: 30_000 }
    )
    return { output }
  }

  return {
    name: config.name,
    description: config.description,
    capability: config.capability,
    execute,
  }
}
