/**
 * SOURCE OF TRUTH KEYWORDS: AiGatewayTypes, providerKindSchema,
 *   aiCapabilitySchema, createAiProviderSchema, updateAiProviderSchema,
 *   upsertAiModelSchema, setCapabilityRouteSchema, applyRoutingPresetSchema,
 *   ChatMessage, AiErrorKind, AiCallContext, AiUsage
 *
 * WHAT:  Input contracts for the aiProviders router / settings forms, and the
 *        AI Gateway's request, result, and error-kind types.
 * WHY:   Forms and router validate against the SAME schemas (CLAUDE.md rule 5).
 *        Gateway types live here (not in src/lib/ai) because CLAUDE.md keeps
 *        every custom type under lib/types. ProviderKind / AiCapability come
 *        from the generated Prisma client — never re-listed.
 * WHERE: src/trpc/routers/ai-providers.ts, src/lib/ai/*, and the AI Providers
 *        settings page. Re-exported via src/lib/types.
 */

import { z } from 'zod'

import { AiCapability, ProviderKind } from '@/generated/prisma'

export const providerKindSchema = z.enum(ProviderKind)
export const aiCapabilitySchema = z.enum(AiCapability)

/* An API key is opaque, but anything beyond this is a paste accident. */
const API_KEY_MAX = 500

/**
 * SOURCE OF TRUTH KEYWORDS: baseUrlSchema, providerBaseUrl
 *
 * WHAT:  An http(s) base URL for an OpenAI-compatible endpoint.
 * WHY:   Only the scheme is checked here; whether the HOST may be reached
 *        (private-network / SSRF rules) is enforced server-side at call time by
 *        src/lib/ai/url-guard.ts, because DNS can change after validation.
 */
export const baseUrlSchema = z
  .string()
  .trim()
  .url('Enter a valid URL.')
  .max(500)
  .refine((value) => /^https?:\/\//i.test(value), 'URL must start with http:// or https://')

/**
 * SOURCE OF TRUTH KEYWORDS: createAiProviderSchema, CreateAiProviderValues
 *
 * WHAT:  Connect a provider. `apiKey` may be blank only for LOCAL endpoints
 *        (Ollama / LM Studio run keyless).
 * WHERE: aiProviders.create; the "Connect provider" dialog.
 */
export const createAiProviderSchema = z
  .object({
    organizationId: z.string().min(1),
    name: z.string().trim().min(2, 'Give this connection a name.').max(60),
    kind: providerKindSchema,
    baseUrl: baseUrlSchema,
    apiKey: z.string().trim().max(API_KEY_MAX),
  })
  .refine((v) => v.kind === ProviderKind.LOCAL || v.apiKey.length > 0, {
    path: ['apiKey'],
    message: 'An API key is required for this provider.',
  })

export type CreateAiProviderValues = z.infer<typeof createAiProviderSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: updateAiProviderSchema, UpdateAiProviderValues
 *
 * WHAT:  Edit a provider. A blank `apiKey` keeps the stored key — the client
 *        never sees the existing key, so it cannot resend it.
 * WHERE: aiProviders.update; the provider edit dialog.
 */
export const updateAiProviderSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1),
  name: z.string().trim().min(2, 'Give this connection a name.').max(60),
  baseUrl: baseUrlSchema,
  apiKey: z.string().trim().max(API_KEY_MAX),
  isEnabled: z.boolean(),
})

export type UpdateAiProviderValues = z.infer<typeof updateAiProviderSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: upsertAiModelSchema, UpsertAiModelValues
 *
 * WHAT:  Register or edit a model on a provider, with its capabilities and
 *        per-million-token prices (USD).
 * WHY:   Prices are entered by the user from their provider's pricing page;
 *        they drive every cost figure in the app, so they are required (0 is a
 *        valid price for local models).
 * WHERE: aiProviders.upsertModel; the model dialog.
 */
export const upsertAiModelSchema = z.object({
  organizationId: z.string().min(1),
  id: z.string().min(1).nullable(),
  providerId: z.string().min(1),
  modelId: z.string().trim().min(1, 'Enter the model id the provider uses.').max(120),
  displayName: z.string().trim().min(1, 'Enter a display name.').max(80),
  capabilities: z.array(aiCapabilitySchema).min(1, 'Pick at least one capability.'),
  inputPricePerMTok: z.number().min(0).max(10_000),
  outputPricePerMTok: z.number().min(0).max(10_000),
  supportsJsonSchema: z.boolean(),
  contextWindow: z.number().int().min(1_000).max(10_000_000).nullable(),
  isEnabled: z.boolean(),
})

export type UpsertAiModelValues = z.infer<typeof upsertAiModelSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: setCapabilityRouteSchema, SetCapabilityRouteValues
 *
 * WHAT:  Point one capability at a primary model (and optional fallback).
 * WHERE: aiProviders.setRoute; the routing table.
 */
export const setCapabilityRouteSchema = z
  .object({
    organizationId: z.string().min(1),
    capability: aiCapabilitySchema,
    modelId: z.string().min(1),
    fallbackModelId: z.string().min(1).nullable(),
  })
  .refine((v) => v.fallbackModelId !== v.modelId, {
    path: ['fallbackModelId'],
    message: 'The fallback must be a different model.',
  })

export type SetCapabilityRouteValues = z.infer<typeof setCapabilityRouteSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: ROUTING_PRESETS, RoutingPreset,
 *   applyRoutingPresetSchema, ApplyRoutingPresetValues
 *
 * WHAT:  One-click routing presets (blueprint §22). How each preset picks
 *        models lives in src/lib/ai/routing.ts (buildPresetRoutes).
 * WHERE: aiProviders.applyPreset; the routing section's preset buttons.
 */
export const ROUTING_PRESETS = ['ECONOMY', 'BALANCED', 'BEST_QUALITY'] as const
export const routingPresetSchema = z.enum(ROUTING_PRESETS)
export type RoutingPreset = z.infer<typeof routingPresetSchema>

export const applyRoutingPresetSchema = z.object({
  organizationId: z.string().min(1),
  preset: routingPresetSchema,
})

export type ApplyRoutingPresetValues = z.infer<typeof applyRoutingPresetSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: ChatMessage, ChatRole
 *
 * WHAT:  Provider-neutral chat message the gateway accepts from agents.
 *        `images` (data URLs) attach pictures to a user message for vision
 *        models, e.g. a scanned book page.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  images?: readonly string[]
}

/**
 * SOURCE OF TRUTH KEYWORDS: AI_ERROR_KINDS, AiErrorKind, RETRYABLE_AI_ERROR_KINDS
 *
 * WHAT:  Every way a gateway call can fail, normalised across providers.
 * WHY:   The task runner retries on kind, not on provider-specific status codes
 *        or messages; AgentTask.errorKind / AiUsageEvent.errorKind store these.
 * WHERE: Thrown as AiGatewayError (src/lib/ai/errors.ts).
 */
export const AI_ERROR_KINDS = [
  'auth',
  'rate_limit',
  'timeout',
  'network',
  'server',
  'not_found',
  'bad_request',
  'content_policy',
  'invalid_output',
  'not_configured',
  'blocked_url',
] as const

export type AiErrorKind = (typeof AI_ERROR_KINDS)[number]

/**
 * SOURCE OF TRUTH KEYWORDS: SPARE_MODEL_AI_ERROR_KINDS, spare model, model
 *   switch, automatic model fallback
 *
 * WHAT:  Failures that say "this MODEL could not do it" rather than "the
 *        provider or the request is broken": bad structured output, a model id
 *        the provider no longer serves, a parameter it rejects, its server
 *        erroring or timing out.
 * WHY:   On these the gateway tries the workspace's other enabled models for
 *        the same capability (a weak model kept failing planning on desktop
 *        while a stronger one sat unused). Auth, rate limits, content policy
 *        and configuration errors are excluded: another model would hit the
 *        same wall or hide a problem the user must fix.
 * WHERE: withFallback in src/lib/ai/gateway.ts.
 */
export const SPARE_MODEL_AI_ERROR_KINDS: readonly AiErrorKind[] = [
  'invalid_output',
  'not_found',
  'bad_request',
  'server',
  'timeout',
]

export const RETRYABLE_AI_ERROR_KINDS: readonly AiErrorKind[] = [
  'rate_limit',
  'timeout',
  'network',
  'server',
  'invalid_output',
]

/**
 * SOURCE OF TRUTH KEYWORDS: AiCallContext
 *
 * WHAT:  Who/what a gateway call is for — scopes routing to the workspace and
 *        attributes the AiUsageEvent cost row to course, lesson, job, task.
 */
export interface AiCallContext {
  organizationId: string
  agentId: string | null
  courseId: string | null
  lessonId: string | null
  jobId: string | null
  taskId: string | null
}

/**
 * SOURCE OF TRUTH KEYWORDS: AiUsage, AiGenerateResult
 *
 * WHAT:  Token + cost accounting returned with every successful call, and the
 *        envelope the gateway returns to agents.
 */
export interface AiUsage {
  inputTokens: number
  outputTokens: number
  costMicros: bigint
  latencyMs: number
}

export interface AiGenerateResult<T> {
  data: T
  usage: AiUsage
  model: { id: string; modelId: string; displayName: string; providerName: string }
}

/**
 * SOURCE OF TRUTH KEYWORDS: ProviderConnectionResult, testConnection
 *
 * WHAT:  Outcome of aiProviders.testConnection — reachable models on success,
 *        a normalised error otherwise.
 */
export type ProviderConnectionResult =
  | { ok: true; latencyMs: number; modelIds: string[] }
  | { ok: false; latencyMs: number; errorKind: AiErrorKind; message: string }

/**
 * SOURCE OF TRUTH KEYWORDS: saveVoiceProfileSchema, SaveVoiceProfileValues,
 *   VOICE_SPEED_LIMITS, narration voice settings
 *
 * WHAT:  One TTS model's narration voice: provider voice id, speed, and
 *        style instructions (honoured by instruction-capable TTS models).
 *        Each model keeps its own, since voice ids only work on their model.
 * WHERE: aiProviders.saveVoice / previewVoice; Narration voice form.
 */
export const VOICE_SPEED_LIMITS = { min: 0.75, max: 1.5 } as const

export const saveVoiceProfileSchema = z.object({
  organizationId: z.string().min(1),
  /* The AiModel this voice belongs to. */
  aiModelId: z.string().min(1, 'Choose a voice model.'),
  voice: z.string().trim().min(1, 'Choose a voice.').max(120),
  speed: z.number().min(VOICE_SPEED_LIMITS.min).max(VOICE_SPEED_LIMITS.max),
  instructions: z.string().trim().max(500),
})

export type SaveVoiceProfileValues = z.infer<typeof saveVoiceProfileSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: VoiceOption, VoiceControls, VoiceCatalogSource,
 *   NarrationVoiceModel, SavedNarrationVoice, LiveVoiceList, NarrationModelChoice,
 *   listModelVoicesSchema, SpeechDelivery,
 *   live voice list, voice picker, speed range, style instructions
 *
 * WHAT:  One pickable voice, the controls a TTS model honours (speed range,
 *        style instructions), the voice choices of one TTS model, and the
 *        models offered in the voice picker with their Narration role.
 * WHY:   Voices come from the provider when it can list them (ElevenLabs,
 *        local servers, SiliconFlow custom voices) and from the built-in
 *        catalog otherwise; the form, router and gateway share these shapes.
 * WHERE: VOICE_CATALOG and resolveVoiceForModel (lib/config/ai-providers.ts),
 *        listModelVoices and synthesizeSpeech (gateway), aiProviders.listVoices,
 *        NarrationVoiceForm, narrator agent.
 */
export interface VoiceOption {
  id: string
  label: string
  /** e.g. "british · female · cloned"; null when the provider gives none. */
  description: string | null
}

export interface VoiceControls {
  /** null = the model ignores speed. */
  speed: { min: number; max: number } | null
  /** true = speaking style instructions are sent to the model. */
  style: boolean
}

/** A provider's own voice list: `complete` replaces the catalog, else it adds to it. */
export interface LiveVoiceList {
  voices: VoiceOption[]
  complete: boolean
}

export const VOICE_CATALOG_SOURCES = ['live', 'catalog'] as const
export type VoiceCatalogSource = (typeof VOICE_CATALOG_SOURCES)[number]

/** A stored profile; aiModelId is null only for voices saved before per model voices. */
export type SavedNarrationVoice = Omit<SaveVoiceProfileValues, 'organizationId' | 'aiModelId'> & { aiModelId: string | null }

/** Per call adjustments on top of a profile (the course's learner level). */
export interface SpeechDelivery {
  speedFactor: number
  style: string
}

export const NARRATION_ROUTE_ROLES = ['primary', 'fallback'] as const
export type NarrationRouteRole = (typeof NARRATION_ROUTE_ROLES)[number]

export interface NarrationModelChoice {
  id: string
  displayName: string
  providerName: string
  /** Its place in the Narration route; null when not routed. */
  role: NarrationRouteRole | null
}

export const listModelVoicesSchema = z.object({
  organizationId: z.string().min(1),
  aiModelId: z.string().min(1),
})
export type ListModelVoicesValues = z.infer<typeof listModelVoicesSchema>

export interface NarrationVoiceModel {
  aiModelId: string
  modelId: string
  displayName: string
  providerName: string
  providerKind: ProviderKind
  voices: VoiceOption[]
  defaultVoice: string
  controls: VoiceControls
  source: VoiceCatalogSource
  /** Why the live list could not be read; null when it was (or none exists). */
  notice: string | null
}

/**
 * SOURCE OF TRUTH KEYWORDS: elevenLabsVoicesResponseSchema,
 *   elevenLabsModelsResponseSchema, elevenLabsErrorSchema,
 *   compatibleVoicesResponseSchema, siliconFlowVoiceListSchema,
 *   provider voice list replies
 *
 * WHAT:  The parts of provider voice and model list replies the adapters
 *        read: ElevenLabs GET /voices and /models, the GET /audio/voices
 *        list served by local OpenAI-compatible servers (Kokoro FastAPI), and
 *        SiliconFlow's custom voice list.
 * WHY:   Provider replies are untrusted input; a changed API becomes a clear
 *        invalid_output error instead of a crash.
 * WHERE: src/lib/ai/adapters/{elevenlabs,openai-compatible}.ts.
 */
export const elevenLabsVoicesResponseSchema = z.object({
  voices: z.array(
    z.object({
      voice_id: z.string().min(1),
      name: z.string().nullish(),
      category: z.string().nullish(),
      labels: z.record(z.string(), z.string().nullish()).nullish(),
    })
  ),
})

export const elevenLabsModelsResponseSchema = z.array(
  z.object({ model_id: z.string().min(1), can_do_text_to_speech: z.boolean().nullish() })
)

export const elevenLabsErrorSchema = z.object({
  detail: z.union([z.string(), z.object({ message: z.string().nullish(), status: z.string().nullish() })]),
})

export const compatibleVoicesResponseSchema = z.object({
  voices: z.array(z.union([z.string().min(1), z.object({ id: z.string().min(1), name: z.string().nullish() })])),
})

export const siliconFlowVoiceListSchema = z.object({
  result: z.array(z.object({ uri: z.string().min(1), customName: z.string().nullish(), model: z.string().nullish() })),
})

/**
 * SOURCE OF TRUTH KEYWORDS: AiSpeechResult, synthesized narration
 *
 * WHAT:  Audio returned by the gateway's speech call, with its measured
 *        length and detected container (providers may ignore the requested
 *        format, so the bytes are inspected, never assumed).
 */
/**
 * SOURCE OF TRUTH KEYWORDS: AiImageResult, generated illustration
 *
 * WHAT:  A picture returned by the gateway's image call, with its detected
 *        format (read from the bytes, never assumed).
 */
export interface AiImageResult {
  image: Uint8Array
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  extension: 'png' | 'jpg' | 'webp'
  usage: AiUsage
  model: AiGenerateResult<never>['model']
}

export interface AiSpeechResult {
  audio: Uint8Array
  mimeType: 'audio/mpeg' | 'audio/wav' | 'audio/ogg' | 'audio/aac' | 'audio/flac'
  extension: 'mp3' | 'wav' | 'ogg' | 'aac' | 'flac'
  durationMs: number
  usage: AiUsage
  /** The voice id that spoke, after per-model resolution. */
  voice: string
  model: AiGenerateResult<never>['model']
}

/**
 * SOURCE OF TRUTH KEYWORDS: verifyAiProviderSchema, VerifyAiProviderValues,
 *   credential check before save
 *
 * WHAT:  Checks a base URL + key with the provider BEFORE saving. A blank key
 *        with `providerId` re-uses the stored key (edit form). `kind` picks
 *        how the provider lists its models.
 * WHERE: aiProviders.verifyCredentials; provider connect/edit dialogs.
 */
export const verifyAiProviderSchema = z.object({
  organizationId: z.string().min(1),
  providerId: z.string().min(1).nullable(),
  /* Picks the provider's own model list call (ElevenLabs is not OpenAI shaped). */
  kind: providerKindSchema,
  baseUrl: baseUrlSchema,
  apiKey: z.string().trim().max(API_KEY_MAX),
})

export type VerifyAiProviderValues = z.infer<typeof verifyAiProviderSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: dashScopeSpeechResponseSchema, DashScopeSpeechResponse,
 *   qwen3-tts response, DashScope native TTS
 *
 * WHAT:  The parts of a DashScope multimodal-generation (TTS) reply the
 *        adapter reads: the audio URL on success, code and message on error.
 * WHY:   Provider replies are untrusted input; parsing them with Zod turns a
 *        changed API into a clear invalid_output error instead of a crash.
 * WHERE: src/lib/ai/adapters/dashscope.ts.
 */
export const dashScopeSpeechResponseSchema = z.object({
  output: z.object({ audio: z.object({ url: z.string().url() }) }).optional(),
  code: z.string().optional(),
  message: z.string().optional(),
})

export type DashScopeSpeechResponse = z.infer<typeof dashScopeSpeechResponseSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: dashScopeImageResponseSchema, openAiImageResponseSchema,
 *   image generation reply, qwen-image response, images/generations response
 *
 * WHAT:  The parts of an image-generation reply the adapters read: Alibaba's
 *        native reply (image URL in output.choices[0].message.content[0].image)
 *        and the OpenAI-style reply (data[0].b64_json or data[0].url).
 * WHY:   Provider replies are untrusted input; a changed API becomes a clear
 *        invalid_output error. Alibaba's URLs expire after 24 hours, so the
 *        adapter downloads the image at once.
 * WHERE: src/lib/ai/adapters/{dashscope,openai-compatible}.ts.
 */
export const dashScopeImageResponseSchema = z.object({
  output: z
    .object({
      choices: z.array(
        z.object({ message: z.object({ content: z.array(z.object({ image: z.string().url().optional() })) }) })
      ),
    })
    .optional(),
  code: z.string().optional(),
  message: z.string().optional(),
})

export const openAiImageResponseSchema = z.object({
  data: z.array(z.object({ b64_json: z.string().optional(), url: z.string().url().optional() })).min(1),
})
