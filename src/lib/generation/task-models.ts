/**
 * SOURCE OF TRUTH KEYWORDS: summarizeTaskModels, TaskModelUse, TaskModelCall,
 *   models tried by a step, fallback model order, AiUsageEvent per task
 *
 * WHAT:  Folds a step's AiUsageEvent rows into the distinct models it called,
 *        oldest first, each with the outcome of its latest call.
 * WHY:   The activity card shows which model ran (or failed) for every step,
 *        so a "model not exist" or a slow model can be traced to the exact
 *        provider model id without opening the database.
 *        Pure (no server imports).
 * WHERE: generationJobs.get (per task), AgentActivity.
 */

import type { TaskModelCall, TaskModelUse } from '@/lib/types'

export function summarizeTaskModels(calls: readonly TaskModelCall[]): TaskModelUse[] {
  const byModel = new Map<string, TaskModelUse>()
  const ordered = [...calls].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  for (const call of ordered) {
    const key = `${call.providerName}\u0000${call.modelName}`
    /* Re-inserting keeps first-use order while the outcome tracks the latest call. */
    byModel.set(key, { modelName: call.modelName, providerName: call.providerName, success: call.success, errorKind: call.errorKind })
  }
  return [...byModel.values()]
}
