import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: openAiCompatibleAdapter, ProviderEndpoint,
 *   createChatCompletion, listProviderModels, ChatCompletionOutcome,
 *   ResponseFormatRequest, OpenAI SDK baseURL
 *
 * WHAT:  The one transport for every MVP 1 provider — Alibaba DashScope
 *        compatible-mode, DeepSeek, OpenAI, OpenRouter, local servers, custom
 *        endpoints — via the official `openai` SDK with a baseURL override.
 * WHY:   All targets speak the chat-completions protocol, so one adapter
 *        replaces six. SDK retries are OFF (`maxRetries: 0`): retry policy
 *        belongs to the task runner, which retries on AiErrorKind with backoff
 *        and records every attempt in the cost ledger. Every call passes the
 *        SSRF guard first. Errors leave this file only as AiGatewayError.
 * WHERE: Called by src/lib/ai/gateway.ts only. Agents never import it.
 */

import OpenAI from 'openai'

import { openAiImageResponseSchema, type ChatMessage } from '@/lib/types'
import { AiGatewayError, aiErrorFromStatus, toAiGatewayError } from '../errors'
import { assertProviderUrlAllowed } from '../url-guard'

export interface ProviderEndpoint {
  baseUrl: string
  /** null for keyless local servers. */
  apiKey: string | null
}

export type ResponseFormatRequest =
  | { type: 'text' }
  | { type: 'json_object' }
  | { type: 'json_schema'; name: string; schema: Record<string, unknown> }

export interface ChatCompletionOutcome {
  content: string
  inputTokens: number
  outputTokens: number
  finishReason: string | null
}

const DEFAULT_TIMEOUT_MS = 180_000
const LIST_MODELS_TIMEOUT_MS = 15_000
const MAX_LISTED_MODELS = 500

function createClient(endpoint: ProviderEndpoint, timeoutMs: number): OpenAI {
  return new OpenAI({
    baseURL: endpoint.baseUrl,
    /* The SDK requires a non-empty key; keyless local servers ignore it. */
    apiKey: endpoint.apiKey ?? 'not-required',
    timeout: timeoutMs,
    maxRetries: 0,
  })
}

/* Text-only messages stay plain strings; a user message with images becomes
 * content parts (images first, then the instruction), the OpenAI vision shape
 * every compatible vision server accepts. */
function toSdkMessage(message: ChatMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (message.role === 'user' && message.images && message.images.length > 0) {
    return {
      role: 'user',
      content: [
        ...message.images.map((url) => ({ type: 'image_url' as const, image_url: { url } })),
        { type: 'text' as const, text: message.content },
      ],
    }
  }
  return message.role === 'user'
    ? { role: 'user', content: message.content }
    : message.role === 'assistant'
      ? { role: 'assistant', content: message.content }
      : { role: 'system', content: message.content }
}

function toSdkResponseFormat(format: ResponseFormatRequest) {
  if (format.type === 'json_schema') {
    /* strict:false — strict mode only accepts a JSON-Schema subset that varies
     * by provider; the gateway validates every response with Zod regardless. */
    return {
      type: 'json_schema' as const,
      json_schema: { name: format.name, schema: format.schema, strict: false },
    }
  }
  return { type: format.type }
}

export async function createChatCompletion(
  endpoint: ProviderEndpoint,
  params: {
    model: string
    messages: readonly ChatMessage[]
    temperature: number | null
    maxOutputTokens: number | null
    responseFormat: ResponseFormatRequest
    timeoutMs?: number
  }
): Promise<ChatCompletionOutcome> {
  await assertProviderUrlAllowed(endpoint.baseUrl)
  const client = createClient(endpoint, params.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  try {
    const completion = await client.chat.completions.create({
      model: params.model,
      messages: params.messages.map(toSdkMessage),
      ...(params.temperature !== null ? { temperature: params.temperature } : {}),
      /* `max_tokens` (not max_completion_tokens): the field every compatible
       * server still understands. */
      ...(params.maxOutputTokens !== null ? { max_tokens: params.maxOutputTokens } : {}),
      ...(params.responseFormat.type !== 'text'
        ? { response_format: toSdkResponseFormat(params.responseFormat) }
        : {}),
    })
    const choice = completion.choices[0]
    return {
      content: choice?.message.content ?? '',
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      finishReason: choice?.finish_reason ?? null,
    }
  } catch (error) {
    throw toAiGatewayError(error)
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: listProviderModels
 *
 * WHAT:  GET /models — doubles as the connection test (proves URL + key) and
 *        feeds the model picker with ids the key can actually use.
 */
export async function listProviderModels(endpoint: ProviderEndpoint): Promise<string[]> {
  await assertProviderUrlAllowed(endpoint.baseUrl)
  const client = createClient(endpoint, LIST_MODELS_TIMEOUT_MS)
  try {
    const ids: string[] = []
    for await (const model of client.models.list()) {
      ids.push(model.id)
      if (ids.length >= MAX_LISTED_MODELS) break
    }
    return ids.sort((a, b) => a.localeCompare(b))
  } catch (error) {
    throw toAiGatewayError(error)
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: createSpeech, text to speech, /audio/speech
 *
 * WHAT:  POST /audio/speech — synthesizes narration audio. `instructions`
 *        (speaking style) is sent only when non-empty; servers that do not
 *        support it ignore or reject unknown fields, so it stays optional.
 */
export async function createSpeech(
  endpoint: ProviderEndpoint,
  params: { model: string; voice: string; input: string; speed: number; instructions: string }
): Promise<Uint8Array> {
  await assertProviderUrlAllowed(endpoint.baseUrl)
  const client = createClient(endpoint, DEFAULT_TIMEOUT_MS)
  try {
    const response = await client.audio.speech.create({
      model: params.model,
      voice: params.voice,
      input: params.input,
      speed: params.speed,
      response_format: 'mp3',
      ...(params.instructions ? { instructions: params.instructions } : {}),
    })
    return new Uint8Array(await response.arrayBuffer())
  } catch (error) {
    throw toAiGatewayError(error)
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: createImage, images/generations, OpenAI image
 *   generation, gpt-image-1
 *
 * WHAT:  One image from an OpenAI-compatible /images/generations endpoint,
 *        as bytes (base64 replies decoded, URL replies downloaded).
 * WHY:   Plain HTTP rather than the SDK: providers accept sizes the SDK's
 *        types do not list. Download URLs pass the same URL guard as every
 *        provider call.
 * WHERE: generateImage in src/lib/ai/gateway.ts for non-Alibaba providers.
 */
export async function createImage(
  endpoint: ProviderEndpoint,
  params: { model: string; prompt: string; size: string }
): Promise<Uint8Array> {
  await assertProviderUrlAllowed(endpoint.baseUrl)
  try {
    const response = await fetch(`${endpoint.baseUrl.replace(/\/+$/, '')}/images/generations`, {
      method: 'POST',
      headers: { ...(endpoint.apiKey ? { authorization: `Bearer ${endpoint.apiKey}` } : {}), 'content-type': 'application/json' },
      body: JSON.stringify({ model: params.model, prompt: params.prompt, size: params.size, n: 1 }),
      signal: AbortSignal.timeout(300_000),
    })
    if (!response.ok) throw aiErrorFromStatus(response.status, await response.text().catch(() => `HTTP ${response.status}`))
    const parsed = openAiImageResponseSchema.safeParse(await response.json())
    const first = parsed.success ? parsed.data.data[0] : undefined
    if (first?.b64_json) return new Uint8Array(Buffer.from(first.b64_json, 'base64'))
    if (first?.url) {
      await assertProviderUrlAllowed(first.url)
      const image = await fetch(first.url, { signal: AbortSignal.timeout(300_000) })
      if (!image.ok) throw aiErrorFromStatus(image.status, 'Could not download the generated image.')
      return new Uint8Array(await image.arrayBuffer())
    }
    throw new AiGatewayError('invalid_output', 'The image provider returned no image.')
  } catch (error) {
    throw toAiGatewayError(error)
  }
}
