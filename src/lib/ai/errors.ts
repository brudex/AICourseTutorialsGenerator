import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS:⁠​‌‌​​‌‌​​‌​‌‌‌​​‌‌​‌​​​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​‌‌‌‌​​​‌​​‌​‌​​​‌​​‌‌‌⁠ AiGatewayError, toAiGatewayError,
 *   isRetryableAiError, AiErrorKind, provider error mapping
 *
 * WHAT:  The single error type the AI Gateway throws, and the mapper that
 *        turns any provider/SDK/network failure into one.
 * WHY:   Agents and the task runner decide retry-vs-fail on `kind` alone;
 *        provider-specific status codes and messages stop at this file.
 *        `message` is safe to show the user (never includes the API key).
 * WHERE: Thrown by src/lib/ai/gateway.ts and the adapter; read by the
 *        aiProviders router (testConnection) and the worker's task runner.
 */

import OpenAI from 'openai'

import { RETRYABLE_AI_ERROR_KINDS, type AiErrorKind } from '@/lib/types'

export class AiGatewayError extends Error {
  readonly kind: AiErrorKind
  readonly status: number | null

  constructor(kind: AiErrorKind, message: string, status: number | null = null) {
    super(message)
    this.name = 'AiGatewayError'
    this.kind = kind
    this.status = status
  }
}

export function isRetryableAiError(error: AiGatewayError): boolean {
  return RETRYABLE_AI_ERROR_KINDS.includes(error.kind)
}

/* Some providers return 400 for moderation refusals; the body is the only tell. */
const CONTENT_POLICY_PATTERN = /content[_\s-]?(policy|filter|management)|data_inspection_failed|safety/i

/**
 * SOURCE OF TRUTH KEYWORDS: aiErrorFromStatus, HTTP status to error kind
 *
 * WHAT:  Maps an HTTP status and the provider's error text to an
 *        AiGatewayError.
 * WHY:   Shared by the OpenAI SDK path and adapters that call providers with
 *        plain fetch (DashScope native TTS), so retry decisions match.
 *        A 403 that is not about the key (e.g. Alibaba "AccessDenied.Unpurchased":
 *        the account has not activated that model) keeps the provider's reason
 *        and counts as a model problem, so spare models are tried.
 *        A 404 says what to do: the model id is wrong, or the model is not
 *        enabled for this key, region or workspace (Alibaba "Model not exist").
 *        A 401/403 naming a missing permission is `permission`, not `auth`:
 *        the key works, only that call's scope is off, so it is not rejected.
 */
const KEY_PROBLEM_PATTERN = /api[\s_-]?key|unauthori[sz]ed|authenticat|invalid[\s_-]?(token|key|credential)/i
/* A valid key with a scope switched off, e.g. ElevenLabs "missing the permission voices_read". */
const MISSING_PERMISSION_PATTERN = /missing[\s_-]+(the\s+)?permission/i

export function aiErrorFromStatus(status: number | null, message: string): AiGatewayError {
  const detail = message.slice(0, 300)
  if ((status === 401 || status === 403) && MISSING_PERMISSION_PATTERN.test(detail)) {
    return new AiGatewayError('permission', `This API key is valid but restricted: ${detail}`, status)
  }
  if (status === 403 && detail && !KEY_PROBLEM_PATTERN.test(detail)) {
    return new AiGatewayError('bad_request', `The provider refused access to this model: ${detail}`, status)
  }
  if (status === 401 || status === 403) {
    return new AiGatewayError('auth', 'The provider rejected the API key.', status)
  }
  if (status === 404) {
    return new AiGatewayError(
      'not_found',
      `The provider does not offer this model for your key${detail ? ` (${detail.replace(/\.$/, '')})` : ''}. Check the model id, or enable the model for this account, region or workspace in the provider's console.`,
      status
    )
  }
  if (status === 429) {
    return new AiGatewayError('rate_limit', 'Rate limited by the provider. Retrying later usually works.', status)
  }
  if (status !== null && status >= 500) {
    return new AiGatewayError('server', `The provider had an error (${status}).`, status)
  }
  if (CONTENT_POLICY_PATTERN.test(detail)) {
    return new AiGatewayError('content_policy', 'The provider refused this request on content-policy grounds.', status)
  }
  return new AiGatewayError('bad_request', `The provider rejected the request: ${detail}`, status)
}

/**
 * SOURCE OF TRUTH KEYWORDS: toAiGatewayError
 *
 * WHAT:  Normalises a thrown value into an AiGatewayError.
 * WHY:   Ordered most-specific first: the SDK's typed subclasses, then raw
 *        status codes (OpenAI-compatible servers don't all map to subclasses),
 *        then Node network errors.
 */
export function toAiGatewayError(error: unknown): AiGatewayError {
  if (error instanceof AiGatewayError) return error

  if (error instanceof OpenAI.APIConnectionTimeoutError) {
    return new AiGatewayError('timeout', 'The provider did not respond in time.')
  }
  if (error instanceof OpenAI.APIConnectionError) {
    return new AiGatewayError('network', 'Could not reach the provider. Check the base URL and your network.')
  }
  if (error instanceof OpenAI.APIError) {
    return aiErrorFromStatus(typeof error.status === 'number' ? error.status : null, error.message)
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return new AiGatewayError('timeout', 'The provider did not respond in time.')
  }
  return new AiGatewayError('network', error instanceof Error ? error.message : 'Unknown provider error.')
}
