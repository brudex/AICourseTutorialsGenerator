import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: generation barrel, src/lib/generation
 *
 * WHAT:  Public surface of the generation engine (job DAG + lifecycle).
 * WHERE: Routers that create/cancel/retry jobs; the worker.
 */

export {
  createGenerationJob,
  markJobStarted,
  recordTaskSuccess,
  recordTaskFailure,
  recordTaskCancelled,
  finalizeJobIfSettled,
  cancelGenerationJob,
  retryFailedTask,
  recoverStaleTasks,
  retryDelayMs,
} from './lifecycle'
export { validateTaskGraph, findUnblockedKeys, collectDependentKeys } from './dag'
export { JobCancelledError, AgentInputError } from './errors'
export { JOB_COMPLETION_HOOKS } from './hooks'
