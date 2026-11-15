import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: agents barrel, src/lib/agents
 *
 * WHAT:  Public surface of the agent team.
 * WHERE: The worker (getAgent) and agent files (defineAgent).
 */

export { defineAgent } from './define-agent'
export { AGENT_REGISTRY, getAgent } from './registry'
export type { AgentId } from './registry'
