/**
 * SOURCE OF TRUTH KEYWORDS: JobCancelledError, AgentInputError,
 *   generation errors
 *
 * WHAT:  Non-AI errors the generation engine distinguishes.
 *        - JobCancelledError: the job was cancelled while an agent ran; its
 *          output must be discarded and the task marked CANCELLED.
 *        - AgentInputError: a task's stored input or loaded Course State is
 *          unusable — retrying cannot help, so it fails immediately.
 * WHERE: Thrown by defineAgent (src/lib/agents); handled by the worker's
 *        task runner.
 */

export class JobCancelledError extends Error {
  constructor() {
    super('The job was cancelled.')
    this.name = 'JobCancelledError'
  }
}

export class AgentInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AgentInputError'
  }
}
