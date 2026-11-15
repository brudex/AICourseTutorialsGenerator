import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: runClaimedTask, task runner, classifyFailure,
 *   worker task execution
 *
 * WHAT:  Runs one claimed AgentTask end to end and records the outcome.
 * WHY:   The single place that maps "what went wrong" to "what happens next":
 *          • AiGatewayError → retry if its kind is retryable, else fail;
 *          • AgentInputError / unknown agent → fail, no retry;
 *          • JobCancelledError → task CANCELLED, output discarded;
 *          • anything unexpected → retry (could be a transient DB blip),
 *            bounded by maxAttempts.
 *        Never throws: a failing task must not take the worker loop down.
 * WHERE: Called by the worker loop (src/worker/index.ts) for each claimed id.
 */

import { prisma } from '@/lib/config'
import { AiGatewayError, isRetryableAiError } from '@/lib/ai'
import { getAgent } from '@/lib/agents'
import {
  AgentInputError,
  JobCancelledError,
  markJobStarted,
  recordTaskCancelled,
  recordTaskFailure,
  recordTaskSuccess,
} from '@/lib/generation'
import * as generationService from '@/services/generation.service'

interface FailureClassification {
  message: string
  kind: string
  retryable: boolean
}

function classifyFailure(error: unknown): FailureClassification {
  if (error instanceof AiGatewayError) {
    return { message: error.message, kind: error.kind, retryable: isRetryableAiError(error) }
  }
  if (error instanceof AgentInputError) {
    return { message: error.message, kind: 'invalid_input', retryable: false }
  }
  return {
    message: error instanceof Error ? error.message : 'Unexpected error while running this task.',
    kind: 'internal',
    retryable: true,
  }
}

export async function runClaimedTask(taskId: string, log: (line: string) => void): Promise<void> {
  const task = await generationService.findTaskForRun(prisma, taskId)
  if (!task) return
  const label = `${task.agentId} [${task.key}] attempt ${task.attempt}/${task.maxAttempts}`
  const ref = { id: task.id, jobId: task.job.id, key: task.key, attempt: task.attempt, maxAttempts: task.maxAttempts }

  try {
    await markJobStarted(task.job.id)

    const agent = getAgent(task.agentId)
    if (!agent) throw new AgentInputError(`No agent named "${task.agentId}" is registered.`)

    log(`▶ ${label}`)
    const startedAt = Date.now()
    const result = await agent.execute({
      db: prisma,
      task: { id: task.id, key: task.key, agentId: task.agentId, attempt: task.attempt, input: task.input },
      job: {
        id: task.job.id,
        kind: task.job.kind,
        organizationId: task.job.organizationId,
        courseId: task.job.courseId,
        createdById: task.job.createdById,
      },
    })
    await recordTaskSuccess(ref, result.output)
    log(`✓ ${label} in ${Math.round((Date.now() - startedAt) / 1000)}s`)
  } catch (error) {
    try {
      if (error instanceof JobCancelledError) {
        await recordTaskCancelled(ref)
        log(`■ ${label} — job cancelled, output discarded`)
        return
      }
      const failure = classifyFailure(error)
      const outcome = await recordTaskFailure(ref, failure)
      log(`${outcome === 'retrying' ? '↻' : '✗'} ${label} — ${failure.kind}: ${failure.message}`)
    } catch (recordError) {
      /* Recording failed too (DB down?). The stale-lock sweep will recover it. */
      log(`! ${label} — could not record failure: ${recordError instanceof Error ? recordError.message : String(recordError)}`)
    }
  }
}
