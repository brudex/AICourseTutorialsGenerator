import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: AiGateway, generateStructured, generateText,
 *   testProviderConnection, structured output, JSON repair, fallback model,
 *   AiUsageEvent, cost ledger
 *
 * WHAT:  The ONLY entry points agents use to call an AI model.
 *        - generateStructured: returns data validated against a Zod schema.
 *        - generateText: returns plain text.
 *        - testProviderConnection: proves a saved provider's URL + key work.
 * WHY:   Agents never see a provider, URL, or key (blueprint §34). This file
 *        owns the cross-provider hard parts:
 *          • routing (override → primary → fallback),
 *          • structured output: json_schema when the model supports it, else
 *            json_object with the schema in the prompt; fences/preamble are
 *            stripped; ONE repair turn with the validation errors,
 *          • truncation (finish_reason "length") reported as invalid_output,
 *          • one AiUsageEvent per provider call, success or failure.
 *        It never retries with backoff — that is the task runner's job; it
 *        moves to the fallback model when the primary fails, then to the
 *        workspace's other models for the capability when the failure was
 *        the model's own (withFallback).
 *        Runs OUTSIDE any transaction (calls can take minutes), so usage rows
 *        are written with the plain client.
 * WHERE: Agents (src/lib/agents, planned) via the worker; testProviderConnection
 *        from aiProviders.testConnection.
 */

import { z } from 'zod'

import type { AiCapability } from '@/generated/prisma'
import { prisma, type DbClient } from '@/lib/config'
import type {
  AiCallContext,
  AiGenerateResult,
  AiImageResult,
  AiSpeechResult,
  AiUsage,
  ChatMessage,
  ProviderConnectionResult,
} from '@/lib/types'
import { SPARE_MODEL_AI_ERROR_KINDS } from '@/lib/types'
import * as aiProviderService from '@/services/ai-provider.service'
import type { ModelWithCredentials } from '@/services/ai-provider.service'
import { AiCapability as Capability, ProviderKind } from '@/generated/prisma'
import { probeAudio } from './audio-probe'
import {
  createChatCompletion,
  createImage,
  createSpeech,
  listProviderModels,
  type ChatCompletionOutcome,
  type ProviderEndpoint,
  type ResponseFormatRequest,
} from './adapters/openai-compatible'
import { createDashScopeImage, createDashScopeSpeech } from './adapters/dashscope'
import { calculateCostMicros } from './cost'
import { decryptApiKey } from './crypto'
import { AiGatewayError, toAiGatewayError } from './errors'
import { resolveModelsForCall, resolveSpareModels } from './routing'
import { parseModelJson } from './model-json'

interface BaseRequest {
  context: AiCallContext
  capability: AiCapability
  messages: readonly ChatMessage[]
  temperature?: number
  maxOutputTokens?: number
}

export interface GenerateStructuredRequest<T> extends BaseRequest {
  schema: z.ZodType<T>
  /** Short identifier sent as the JSON-schema name, e.g. "curriculum". */
  schemaName: string
}

const REPAIR_ATTEMPTS = 1

function emptyUsage(): AiUsage {
  return { inputTokens: 0, outputTokens: 0, costMicros: BigInt(0), latencyMs: 0 }
}

function addUsage(total: AiUsage, next: AiUsage): AiUsage {
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    costMicros: total.costMicros + next.costMicros,
    latencyMs: total.latencyMs + next.latencyMs,
  }
}

function endpointFor(model: ModelWithCredentials): ProviderEndpoint {
  const { apiKeyCiphertext, baseUrl } = model.provider
  return { baseUrl, apiKey: apiKeyCiphertext ? decryptApiKey(apiKeyCiphertext) : null }
}

function modelSummary(model: ModelWithCredentials): AiGenerateResult<never>['model'] {
  return {
    id: model.id,
    modelId: model.modelId,
    displayName: model.displayName,
    providerName: model.provider.name,
  }
}

/* Ledger writes must never fail the user's call; a lost row is logged. */
async function recordUsage(
  model: ModelWithCredentials,
  request: BaseRequest,
  usage: AiUsage,
  outcome: { success: true } | { success: false; error: AiGatewayError }
): Promise<void> {
  const { context } = request
  try {
    await aiProviderService.createUsageEvent(prisma, {
      organizationId: context.organizationId,
      courseId: context.courseId,
      lessonId: context.lessonId,
      jobId: context.jobId,
      taskId: context.taskId,
      agentId: context.agentId,
      providerId: model.provider.id,
      modelId: model.id,
      providerName: model.provider.name,
      modelName: model.modelId,
      capability: request.capability,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      costMicros: usage.costMicros,
      latencyMs: usage.latencyMs,
      success: outcome.success,
      errorKind: outcome.success ? null : outcome.error.kind,
    })
  } catch (error) {
    console.error('[ai-gateway] failed to record usage event', error)
  }
}

/* Long outputs need longer waits: at a slow ~40 tokens/s a 12,000 token
 * answer takes five minutes, past the 3 minute default. */
const CHAT_TIMEOUT_FLOOR_MS = 180_000
const SLOW_TOKENS_PER_SECOND = 40
function chatTimeoutMs(maxOutputTokens: number | undefined): number {
  return Math.max(CHAT_TIMEOUT_FLOOR_MS, Math.ceil(((maxOutputTokens ?? 0) / SLOW_TOKENS_PER_SECOND) * 1000))
}

/* One provider round-trip, priced and recorded. */
async function callOnce(
  model: ModelWithCredentials,
  request: BaseRequest,
  messages: readonly ChatMessage[],
  responseFormat: ResponseFormatRequest
): Promise<{ outcome: ChatCompletionOutcome; usage: AiUsage }> {
  const startedAt = Date.now()
  try {
    const outcome = await createChatCompletion(endpointFor(model), {
      model: model.modelId,
      messages,
      temperature: request.temperature ?? null,
      maxOutputTokens: request.maxOutputTokens ?? null,
      responseFormat,
      timeoutMs: chatTimeoutMs(request.maxOutputTokens),
    })
    const usage: AiUsage = {
      inputTokens: outcome.inputTokens,
      outputTokens: outcome.outputTokens,
      costMicros: calculateCostMicros({
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        inputPricePerMTok: Number(model.inputPricePerMTok),
        outputPricePerMTok: Number(model.outputPricePerMTok),
      }),
      latencyMs: Date.now() - startedAt,
    }
    await recordUsage(model, request, usage, { success: true })
    return { outcome, usage }
  } catch (error) {
    const gatewayError = toAiGatewayError(error)
    await recordUsage(model, request, { ...emptyUsage(), latencyMs: Date.now() - startedAt }, {
      success: false,
      error: gatewayError,
    })
    throw gatewayError
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: withFallback, automatic model fallback, spare model
 *
 * WHAT:  Tries the routed models (override, or primary then fallback). If they
 *        all fail for a model-level reason (SPARE_MODEL_AI_ERROR_KINDS), tries
 *        the workspace's other enabled models for the same capability before
 *        giving up. Surfaces the LAST error if everything fails.
 * WHY:   Routing names the preferred model, not the only one allowed; a call
 *        should not fail while another connected model can do the job.
 */
async function withFallback<T>(
  request: BaseRequest,
  run: (model: ModelWithCredentials) => Promise<T>,
  options: { preferJsonSchema: boolean } = { preferJsonSchema: false }
): Promise<T> {
  const routed = await resolveModelsForCall(prisma, {
    organizationId: request.context.organizationId,
    capability: request.capability,
    agentId: request.context.agentId,
  })
  let lastError: AiGatewayError | null = null
  const tried: string[] = []
  for (const model of routed) {
    tried.push(model.id)
    try {
      return await run(model)
    } catch (error) {
      lastError = toAiGatewayError(error)
    }
  }

  if (lastError && SPARE_MODEL_AI_ERROR_KINDS.includes(lastError.kind)) {
    const spares = await resolveSpareModels(prisma, {
      organizationId: request.context.organizationId,
      capability: request.capability,
      excludeIds: tried,
      preferJsonSchema: options.preferJsonSchema,
    })
    for (const model of spares) {
      console.warn(`[ai-gateway] routed model failed (${lastError.kind}); trying ${model.modelId} for ${request.capability}`)
      try {
        return await run(model)
      } catch (error) {
        lastError = toAiGatewayError(error)
      }
    }
  }
  throw lastError ?? new AiGatewayError('not_configured', 'No model available for this call.')
}

/**
 * SOURCE OF TRUTH KEYWORDS: extractJsonPayload
 *
 * WHAT:  Pulls the JSON object out of a model reply that may wrap it in
 *        ```json fences or prefix it with reasoning text.
 */
function extractJsonPayload(content: string): string {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1] ?? content
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  return start !== -1 && end > start ? candidate.slice(start, end + 1) : candidate.trim()
}

type ParseResult<T> = { ok: true; data: T } | { ok: false; problem: string }

/* Lenient parse (raw newlines in code, flattened code) before validation. */
function parseStructured<T>(content: string, schema: z.ZodType<T>): ParseResult<T> {
  const json = parseModelJson(extractJsonPayload(content))
  if (!json.ok) {
    return {
      ok: false,
      problem: 'The reply was not valid JSON. Return one JSON object; inside strings write line breaks as \\n and escape every backslash and double quote.',
    }
  }
  const parsed = schema.safeParse(json.value)
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, problem: z.prettifyError(parsed.error).slice(0, 4_000) }
}

/**
 * SOURCE OF TRUTH KEYWORDS: generateStructured
 *
 * WHAT:  Calls the routed model and returns `schema`-valid data.
 * WHY:   The schema text is ALWAYS included in the system prompt, even in
 *        json_schema mode: some compatible servers accept response_format but
 *        ignore the schema, and OpenAI's json_object mode requires the word
 *        "JSON" in the prompt.
 */
export async function generateStructured<T>(request: GenerateStructuredRequest<T>): Promise<AiGenerateResult<T>> {
  const jsonSchema: Record<string, unknown> = z.toJSONSchema(request.schema)
  const schemaInstruction: ChatMessage = {
    role: 'system',
    content:
      'Respond with a single JSON object and nothing else — no markdown fences, no commentary. ' +
      'It must validate against this JSON Schema:\n' +
      JSON.stringify(jsonSchema),
  }

  /* Structured calls prefer json_schema models when switching to a spare. */
  return withFallback(request, async (model) => {
    const responseFormat: ResponseFormatRequest = model.supportsJsonSchema
      ? { type: 'json_schema', name: request.schemaName, schema: jsonSchema }
      : { type: 'json_object' }

    let messages: ChatMessage[] = [...request.messages, schemaInstruction]
    let usage = emptyUsage()
    let lastProblem = ''

    for (let attempt = 0; attempt <= REPAIR_ATTEMPTS; attempt++) {
      const call = await callOnce(model, request, messages, responseFormat)
      usage = addUsage(usage, call.usage)

      if (call.outcome.finishReason === 'length') {
        throw new AiGatewayError(
          'invalid_output',
          'The model ran out of output tokens before finishing. Try a model with a larger output limit.'
        )
      }

      const parsed = parseStructured(call.outcome.content, request.schema)
      if (parsed.ok) return { data: parsed.data, usage, model: modelSummary(model) }
      lastProblem = parsed.problem

      /* Repair turn: show the model its own reply and exactly what was wrong. */
      messages = [
        ...messages,
        { role: 'assistant', content: call.outcome.content },
        {
          role: 'user',
          content: `That reply did not match the required schema:\n${parsed.problem}\nReturn the corrected JSON object only.`,
        },
      ]
    }

    /* The last validation problem goes into the task error, so a failing
     * agent shows WHY (which field), not only that it failed. */
    throw new AiGatewayError(
      'invalid_output',
      `The model did not return valid structured output after a repair attempt. Last problem: ${lastProblem.replace(/\s+/g, ' ').slice(0, 400)}`
    )
  }, { preferJsonSchema: true })
}

/**
 * SOURCE OF TRUTH KEYWORDS: readImageText, vision call, OCR, scanned page
 *
 * WHAT:  Sends one image with an instruction to the model routed for VISION
 *        and returns its text reply (e.g. the transcription of a page).
 * WHY:   Same accounting and fallback as every other call; VISION never
 *        borrows a text model, because a text model cannot see the image.
 */
export async function readImageText(request: {
  context: AiCallContext
  imageDataUrl: string
  instruction: string
  maxOutputTokens: number
}): Promise<AiGenerateResult<string>> {
  return generateText({
    context: request.context,
    capability: Capability.VISION,
    maxOutputTokens: request.maxOutputTokens,
    messages: [{ role: 'user', content: request.instruction, images: [request.imageDataUrl] }],
  })
}

/**
 * SOURCE OF TRUTH KEYWORDS: generateText
 *
 * WHAT:  Calls the routed model and returns its text reply.
 */
export async function generateText(request: BaseRequest): Promise<AiGenerateResult<string>> {
  return withFallback(request, async (model) => {
    const call = await callOnce(model, request, request.messages, { type: 'text' })
    return { data: call.outcome.content, usage: call.usage, model: modelSummary(model) }
  })
}

/**
 * SOURCE OF TRUTH KEYWORDS: testProviderConnection
 *
 * WHAT:  Lists the provider's models with the stored key. Never throws for
 *        provider failures — returns them as `{ ok: false }` so the UI can
 *        show the reason. Not recorded in the ledger (GET /models is free).
 */
export async function testProviderConnection(
  db: DbClient,
  organizationId: string,
  providerId: string
): Promise<ProviderConnectionResult | null> {
  const provider = await aiProviderService.findProviderCredentials(db, organizationId, providerId)
  if (!provider) return null

  const startedAt = Date.now()
  try {
    const modelIds = await listProviderModels({
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKeyCiphertext ? decryptApiKey(provider.apiKeyCiphertext) : null,
    })
    return { ok: true, latencyMs: Date.now() - startedAt, modelIds }
  } catch (error) {
    const gatewayError = toAiGatewayError(error)
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      errorKind: gatewayError.kind,
      message: gatewayError.message,
    }
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: synthesizeSpeech, narration audio, TTS cost
 *
 * WHAT:  Voices `text` with the workspace's routed TTS model (primary, then
 *        fallback) and returns the audio with its measured duration.
 * WHY:   Same accounting as text calls: one AiUsageEvent per provider call.
 *        TTS is billed per character, so characters are recorded in the
 *        ledger's input-units column and priced with the model's
 *        inputPricePerMTok (USD per 1M characters).
 */
export async function synthesizeSpeech(request: {
  context: AiCallContext
  text: string
  voice: string
  speed: number
  instructions: string
}): Promise<AiSpeechResult> {
  const base: BaseRequest = { context: request.context, capability: Capability.TTS, messages: [] }
  return withFallback(base, async (model) => {
    const startedAt = Date.now()
    try {
      /* Alibaba voices use DashScope's native speech API; everyone else /audio/speech. */
      const audio =
        model.provider.kind === ProviderKind.ALIBABA
          ? await createDashScopeSpeech(endpointFor(model), { model: model.modelId, voice: request.voice, input: request.text })
          : await createSpeech(endpointFor(model), {
              model: model.modelId,
              voice: request.voice,
              input: request.text,
              speed: request.speed,
              instructions: request.instructions,
            })
      const probed = await probeAudio(audio)
      const characters = request.text.length
      const usage: AiUsage = {
        inputTokens: characters,
        outputTokens: 0,
        costMicros: calculateCostMicros({
          inputTokens: characters,
          outputTokens: 0,
          inputPricePerMTok: Number(model.inputPricePerMTok),
          outputPricePerMTok: 0,
        }),
        latencyMs: Date.now() - startedAt,
      }
      await recordUsage(model, base, usage, { success: true })
      return { audio, ...probed, usage, model: modelSummary(model) }
    } catch (error) {
      const gatewayError = toAiGatewayError(error)
      await recordUsage(model, base, { ...emptyUsage(), latencyMs: Date.now() - startedAt }, { success: false, error: gatewayError })
      throw gatewayError
    }
  })
}

/* Widescreen sizes each provider accepts: Qwen-Image's documented 16:9
 * size, and the landscape size OpenAI-style image models support. */
const IMAGE_SIZE_ALIBABA = '2688*1536'
const IMAGE_SIZE_OPENAI = '1536x1024'

/* The picture's real format, read from its first bytes. */
function detectImage(bytes: Uint8Array): Pick<AiImageResult, 'mimeType' | 'extension'> {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return { mimeType: 'image/png', extension: 'png' }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return { mimeType: 'image/jpeg', extension: 'jpg' }
  if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return { mimeType: 'image/webp', extension: 'webp' }
  throw new AiGatewayError('invalid_output', 'The image provider returned a file that is not a picture.')
}

/**
 * SOURCE OF TRUTH KEYWORDS: generateImage, image generation, illustration
 *   call, IMAGE_GENERATION, price per image
 *
 * WHAT:  One widescreen picture from the model routed to IMAGE_GENERATION.
 * WHY:   Same routing, fallback and cost ledger as every call. Alibaba models
 *        use the native API (createDashScopeImage), others the OpenAI-style
 *        endpoint. Image models are priced per picture: the model's input
 *        price holds the price of one image.
 * WHERE: Illustrator (src/lib/agents/illustrator.ts) via the Visual Renderer.
 */
export async function generateImage(request: {
  context: AiCallContext
  prompt: string
  negativePrompt: string
}): Promise<AiImageResult> {
  const base: BaseRequest = { context: request.context, capability: Capability.IMAGE_GENERATION, messages: [] }
  return withFallback(base, async (model) => {
    const startedAt = Date.now()
    try {
      const image =
        model.provider.kind === ProviderKind.ALIBABA
          ? await createDashScopeImage(endpointFor(model), {
              model: model.modelId,
              prompt: request.prompt,
              negativePrompt: request.negativePrompt,
              size: IMAGE_SIZE_ALIBABA,
            })
          : await createImage(endpointFor(model), { model: model.modelId, prompt: request.prompt, size: IMAGE_SIZE_OPENAI })
      const format = detectImage(image)
      const usage: AiUsage = {
        inputTokens: 0,
        outputTokens: 0,
        /* Price per image, in micro-USD. */
        costMicros: BigInt(Math.round(Number(model.inputPricePerMTok) * 1_000_000)),
        latencyMs: Date.now() - startedAt,
      }
      await recordUsage(model, base, usage, { success: true })
      return { image, ...format, usage, model: modelSummary(model) }
    } catch (error) {
      const gatewayError = toAiGatewayError(error)
      await recordUsage(model, base, { ...emptyUsage(), latencyMs: Date.now() - startedAt }, { success: false, error: gatewayError })
      throw gatewayError
    }
  })
}

/**
 * SOURCE OF TRUTH KEYWORDS: verifyProviderCredentials
 *
 * WHAT:  Checks a base URL + key (not yet saved) by listing models. Same
 *        result shape as testProviderConnection, so the UI handles both alike.
 */
export async function verifyProviderCredentials(endpoint: ProviderEndpoint): Promise<ProviderConnectionResult> {
  const startedAt = Date.now()
  try {
    const modelIds = await listProviderModels(endpoint)
    return { ok: true, latencyMs: Date.now() - startedAt, modelIds }
  } catch (error) {
    const gatewayError = toAiGatewayError(error)
    return { ok: false, latencyMs: Date.now() - startedAt, errorKind: gatewayError.kind, message: gatewayError.message }
  }
}
