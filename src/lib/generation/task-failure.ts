/**
 * SOURCE OF TRUTH KEYWORDS:⁠​‌‌​​‌‌​​‌​‌‌‌​​‌‌​‌​​​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​‌‌‌‌​​​‌​​‌​‌​​​‌​​‌‌‌⁠ describeTaskFailure, TASK_FAILURE_COPY, friendly
 *   agent error, failed step message, customer facing generation error
 *
 * WHAT:  Turns a failed (or retrying) agent step's stored error into words a
 *        customer understands, plus what to do next.
 * WHY:   AgentTask.error keeps the precise technical reason for support and
 *        logs ("Highlight lines must satisfy startLine <= endLine ..."), but
 *        customers only need to know whether to retry, wait, or change a
 *        setting. The wording is keyed on AgentTask.errorKind (AiErrorKind,
 *        or 'invalid_input' / 'internal' from the worker), so it does not
 *        depend on provider message text. 'invalid_input' messages are
 *        written in plain language by the agents (AgentInputError), so they
 *        are shown as they are. Pure (no server imports): used in the browser.
 * WHERE: AgentActivity (course workspace).
 */

import type { AiErrorKind, TaskFailureDescription } from '@/lib/types'

const AI_SETTINGS = 'Check AI Providers in Settings, then retry.'

const TASK_FAILURE_COPY: Record<AiErrorKind, Omit<TaskFailureDescription, 'technical'>> = {
  invalid_output: {
    summary: 'The AI’s answer for this step came back incomplete or badly formatted.',
    action: 'Retry usually fixes it. If it keeps failing, route this job to a stronger model in AI Providers.',
  },
  rate_limit: {
    summary: 'The AI provider is busy or your usage limit with them was reached.',
    action: 'Wait a minute, then retry. If it continues, check your plan or balance with the provider.',
  },
  timeout: { summary: 'The AI provider took too long to answer.', action: 'Retry in a moment.' },
  network: { summary: 'The studio could not reach the AI provider.', action: 'Check your internet connection, then retry.' },
  server: { summary: 'The AI provider had a problem on their side.', action: 'Retry in a moment.' },
  not_found: { summary: 'The AI model for this step is no longer available.', action: `Choose another model. ${AI_SETTINGS}` },
  bad_request: { summary: 'The AI model could not accept this request.', action: `Try another model for this job. ${AI_SETTINGS}` },
  auth: { summary: 'Your AI provider did not accept the saved key.', action: `Update the key. ${AI_SETTINGS}` },
  permission: {
    summary: 'Your saved key is not allowed to do this step.',
    action: 'Turn on the missing permission for the key in your provider’s dashboard, then retry.',
  },
  not_configured: { summary: 'No AI model is set up for this step yet.', action: `Choose a model for it. ${AI_SETTINGS}` },
  content_policy: {
    summary: 'The AI provider declined to write this part.',
    action: 'Rephrase the topic or source material, then retry.',
  },
  blocked_url: { summary: 'A link in your source material could not be used.', action: 'Remove the link, then retry.' },
}

function isAiErrorKind(kind: string): kind is AiErrorKind {
  return Object.hasOwn(TASK_FAILURE_COPY, kind)
}

export function describeTaskFailure(task: { error: string | null; errorKind: string | null }): TaskFailureDescription {
  const kind = task.errorKind ?? ''
  if (isAiErrorKind(kind)) return { ...TASK_FAILURE_COPY[kind], technical: task.error !== null }
  if (kind === 'invalid_input' && task.error) return { summary: task.error, action: null, technical: false }
  return {
    summary: 'Something went wrong while running this step.',
    action: 'Retry it. If it keeps failing, send the details to support.',
    technical: task.error !== null,
  }
}
