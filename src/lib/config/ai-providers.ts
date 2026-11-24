/**
 * SOURCE OF TRUTH KEYWORDS: AI_PROVIDER_PRESETS, AiProviderPreset,
 *   SuggestedAiModel, AI_CAPABILITY_LABELS, ProviderKind, baseUrl presets,
 *   ROUTING_PRESET_LABELS
 *
 * WHAT:  Display metadata and default base URLs for every ProviderKind, the
 *        model ids we suggest when connecting one, human labels for
 *        capabilities and routing presets, and the TTS voice catalog.
 * WHY:   Connecting a provider should be "pick Qwen, paste key" — the base URL
 *        and a sensible starter model list come from here. Suggestions carry
 *        NO prices on purpose: provider pricing changes often and a wrong
 *        number would silently corrupt every cost figure, so the user enters
 *        prices from their provider's pricing page.
 *        Client-safe: contains no secrets.
 * WHERE: AI Providers settings page (connect dialog, model dialog, routing
 *        table) and src/lib/ai (base URL fallback).
 */

import type { AiCapability, ProviderKind } from '@/generated/prisma'
import {
  VOICE_SPEED_LIMITS,
  type RoutingPreset,
  type SavedNarrationVoice,
  type VoiceCatalogSource,
  type VoiceControls,
  type VoiceOption,
} from '@/lib/types'

export interface SuggestedAiModel {
  modelId: string
  displayName: string
  capabilities: AiCapability[]
  supportsJsonSchema: boolean
  /** false: offered in the model picker but never chosen by "Set up for me". */
  autoSetup?: boolean
}

export interface AiProviderPreset {
  label: string
  description: string
  defaultBaseUrl: string
  /** Alternate regional endpoints shown as hints under the URL field. */
  alternateBaseUrls: readonly string[]
  apiKeyRequired: boolean
  pricingUrl: string | null
  /** Capabilities this provider's models can serve; null = any. */
  allowedCapabilities: readonly AiCapability[] | null
  suggestedModels: readonly SuggestedAiModel[]
}

export const AI_PROVIDER_PRESETS: Record<ProviderKind, AiProviderPreset> = {
  ALIBABA: {
    label: 'Alibaba Model Studio (Qwen)',
    /* DashScope's compatible mode honours response_format json_schema (verified 2026-11-13). */
    description: 'Qwen models through DashScope’s OpenAI-compatible mode.',
    defaultBaseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    alternateBaseUrls: ['https://dashscope.aliyuncs.com/compatible-mode/v1'],
    apiKeyRequired: true,
    pricingUrl: 'https://www.alibabacloud.com/help/en/model-studio/models',
    allowedCapabilities: null,
    suggestedModels: [
      /* qwen-plus first: it is the model the planning agents are proven on.
       * The legacy qwen-max returned nested curriculum fields as null or
       * strings even with json_schema (desktop run, 2026-11-13), so it is
       * no longer suggested for strong reasoning. */
      { modelId: 'qwen-plus', displayName: 'Qwen Plus', capabilities: ['STRONG_REASONING', 'FAST_TEXT', 'LONG_CONTEXT'], supportsJsonSchema: true },
      { modelId: 'qwen-max', displayName: 'Qwen Max (legacy)', capabilities: ['LONG_CONTEXT'], supportsJsonSchema: false, autoSetup: false },
      { modelId: 'qwen-flash', displayName: 'Qwen Flash', capabilities: ['FAST_TEXT'], supportsJsonSchema: true },
      { modelId: 'qwen3-coder-plus', displayName: 'Qwen3 Coder Plus', capabilities: ['CODING'], supportsJsonSchema: true },
      { modelId: 'qwen3-tts-flash', displayName: 'Qwen3 TTS Flash (voice)', capabilities: ['TTS'], supportsJsonSchema: false },
      { modelId: 'qwen-vl-ocr', displayName: 'Qwen VL OCR (reads scans)', capabilities: ['VISION'], supportsJsonSchema: false },
      { modelId: 'qwen-image-3.0', displayName: 'Qwen Image 3.0 (illustrations)', capabilities: ['IMAGE_GENERATION'], supportsJsonSchema: false },
      { modelId: 'qwen-image-3.0-pro', displayName: 'Qwen Image 3.0 Pro (illustrations)', capabilities: ['IMAGE_GENERATION'], supportsJsonSchema: false },
    ],
  },
  DEEPSEEK: {
    label: 'DeepSeek',
    description: 'DeepSeek chat and reasoning models.',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    alternateBaseUrls: [],
    apiKeyRequired: true,
    pricingUrl: 'https://api-docs.deepseek.com/quick_start/pricing',
    allowedCapabilities: null,
    suggestedModels: [
      { modelId: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: ['FAST_TEXT', 'CODING', 'STRONG_REASONING'], supportsJsonSchema: false },
      { modelId: 'deepseek-reasoner', displayName: 'DeepSeek Reasoner', capabilities: ['STRONG_REASONING'], supportsJsonSchema: false },
    ],
  },
  OPENAI: {
    label: 'OpenAI',
    description: 'OpenAI’s API. Use “Test connection” to list the models your key can use.',
    defaultBaseUrl: 'https://api.openai.com/v1',
    alternateBaseUrls: [],
    apiKeyRequired: true,
    pricingUrl: 'https://openai.com/api/pricing',
    allowedCapabilities: null,
    suggestedModels: [
      { modelId: 'gpt-4.1', displayName: 'GPT-4.1', capabilities: ['STRONG_REASONING', 'CODING', 'LONG_CONTEXT', 'VISION'], supportsJsonSchema: true },
      { modelId: 'gpt-4.1-mini', displayName: 'GPT-4.1 mini', capabilities: ['FAST_TEXT'], supportsJsonSchema: true },
      { modelId: 'gpt-4o-mini-tts', displayName: 'GPT-4o mini TTS', capabilities: ['TTS'], supportsJsonSchema: false },
      { modelId: 'tts-1-hd', displayName: 'TTS-1 HD', capabilities: ['TTS'], supportsJsonSchema: false },
      { modelId: 'gpt-image-1', displayName: 'GPT Image 1 (illustrations)', capabilities: ['IMAGE_GENERATION'], supportsJsonSchema: false },
    ],
  },
  OPENROUTER: {
    label: 'OpenRouter',
    description: 'One key for hundreds of models from many providers.',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    alternateBaseUrls: [],
    apiKeyRequired: true,
    pricingUrl: 'https://openrouter.ai/models',
    allowedCapabilities: null,
    suggestedModels: [],
  },
  LOCAL: {
    label: 'Local model',
    description: 'Ollama, LM Studio, vLLM or any local OpenAI-compatible server.',
    defaultBaseUrl: 'http://localhost:11434/v1',
    alternateBaseUrls: ['http://localhost:1234/v1'],
    apiKeyRequired: false,
    pricingUrl: null,
    allowedCapabilities: null,
    suggestedModels: [],
  },
  ELEVENLABS: {
    label: 'ElevenLabs (voices)',
    description: 'Narration voices, including the ones you cloned or designed in ElevenLabs.',
    defaultBaseUrl: 'https://api.elevenlabs.io/v1',
    alternateBaseUrls: ['https://api.eu.residency.elevenlabs.io/v1'],
    apiKeyRequired: true,
    pricingUrl: 'https://elevenlabs.io/pricing/api',
    allowedCapabilities: ['TTS'],
    suggestedModels: [
      { modelId: 'eleven_multilingual_v2', displayName: 'Eleven Multilingual v2', capabilities: ['TTS'], supportsJsonSchema: false },
      { modelId: 'eleven_flash_v2_5', displayName: 'Eleven Flash v2.5', capabilities: ['TTS'], supportsJsonSchema: false },
      { modelId: 'eleven_turbo_v2_5', displayName: 'Eleven Turbo v2.5', capabilities: ['TTS'], supportsJsonSchema: false },
    ],
  },
  NOVITA: {
    label: 'Novita AI',
    /* Chat models are OpenAI-compatible; Ming Image gets its own request body (createImage). */
    description: 'Ming Image illustrations and open models through Novita’s OpenAI-compatible API.',
    defaultBaseUrl: 'https://api.novita.ai/openai/v1',
    alternateBaseUrls: [],
    apiKeyRequired: true,
    pricingUrl: 'https://novita.ai/pricing',
    allowedCapabilities: null,
    suggestedModels: [
      { modelId: 'ming-image-0.1-design', displayName: 'Ming Image 0.1 Design (illustrations)', capabilities: ['IMAGE_GENERATION'], supportsJsonSchema: false },
    ],
  },
  GEMINI: {
    label: 'Google Gemini',
    /* Google's OpenAI-compatible endpoint; a pasted native /v1beta URL is
     * corrected by normalizeProviderBaseUrl. Keys come from Google AI Studio. */
    description: 'Gemini models through Google’s OpenAI-compatible API. Get a key at aistudio.google.com.',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    alternateBaseUrls: [],
    apiKeyRequired: true,
    pricingUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
    allowedCapabilities: null,
    suggestedModels: [
      { modelId: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', capabilities: ['STRONG_REASONING', 'CODING', 'LONG_CONTEXT', 'VISION'], supportsJsonSchema: true },
      { modelId: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', capabilities: ['FAST_TEXT'], supportsJsonSchema: true },
    ],
  },
  CUSTOM: {
    label: 'Custom (OpenAI-compatible)',
    description: 'Any other endpoint that speaks the OpenAI chat-completions protocol.',
    defaultBaseUrl: 'https://',
    alternateBaseUrls: [],
    apiKeyRequired: true,
    pricingUrl: null,
    allowedCapabilities: null,
    suggestedModels: [],
  },
}

/**
 * SOURCE OF TRUTH KEYWORDS: planAutoSetup, AutoSetupPlan, set up for me,
 *   recommended models, automatic routing, one click AI setup,
 *   inferTextModels, model id by name, custom provider setup
 *
 * WHAT:  For one provider: which models to add (with the exact id the key
 *        offers) and which model each capability should use.
 * WHY:   People who are not technical connect a provider and press one
 *        button. A suggestion is used when the key lists it, or a dated
 *        variant of it (qwen-vl-ocr becomes qwen-vl-ocr-2025-11-20). Speech
 *        and image models are kept even when unlisted, because providers
 *        often leave them out of GET /models; with no list at all, every
 *        suggestion is used. Each capability goes to the first suggestion
 *        whose main role (first capability) it is, else the first that
 *        serves it; only models that win a capability are added.
 *        Text and vision jobs the suggestions leave open are then filled from
 *        the key's own model list by name (inferTextModels), so Custom,
 *        OpenRouter and local servers, and plans with newer model ids than
 *        the suggestions, still get set up. Speech and pictures are never
 *        guessed: they need provider specific APIs.
 * WHERE: aiProviders.autoSetup; canAutoSetup (connect dialog, provider rows).
 */
const UNLISTED_OK: readonly AiCapability[] = ['TTS', 'IMAGE_GENERATION']

export interface AutoSetupPlan {
  models: SuggestedAiModel[]
  /** Capability → the provider model id that should serve it. */
  routes: Partial<Record<AiCapability, string>>
}

/* Ids that are not chat models (speech, audio, pictures, video, embeddings) or a router alias. */
const NOT_A_CHAT_MODEL = /tts|asr|speech|audio|whisper|realtime|video|embed|rerank|moderation|image|^wan\d|flux|sdxl|dall-e|^auto$/i
const VISION_MODEL = /(^|[-_.])(vl|ocr|vision)([-_.]|$)/i
const CODING_MODEL = /coder|codestral/i
const FAST_MODEL = /flash|mini|turbo|lite|haiku|nano|small|fast/i
/* Higher tier = stronger model within a family. */
const STRONG_TIERS: ReadonlyArray<readonly [RegExp, number]> = [
  [/max|opus|ultra/i, 3],
  [/pro|reasoner|large|sonnet/i, 2],
  [/plus|medium/i, 1],
]
const DATED_SNAPSHOT = /-\d{4,8}$/
const PRE_RELEASE = /preview|beta|exp/i

/* Larger is better: stable alias over dated snapshot or preview, then the newest version number. */
function modelRank(id: string, tier: number): number[] {
  const version = Number.parseFloat(id.match(/\d+(?:\.\d+)?/)?.[0] ?? '0')
  return [PRE_RELEASE.test(id) ? 0 : 1, tier, DATED_SNAPSHOT.test(id) ? 0 : 1, version]
}

/* Lexicographic compare of two ranks: positive when `a` is better. */
function compareRank(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function best(ids: readonly string[], tier: (id: string) => number = () => 0): string | null {
  let winner: { id: string; rank: number[] } | null = null
  for (const id of ids) {
    const rank = modelRank(id, tier(id))
    if (!winner || compareRank(rank, winner.rank) > 0) winner = { id, rank }
  }
  return winner?.id ?? null
}

/* Strong, fast, coding, long context and vision picks from a plain list of model ids. */
function inferTextModels(availableModelIds: readonly string[]): Partial<Record<AiCapability, string>> {
  const chat = availableModelIds.filter((id) => !NOT_A_CHAT_MODEL.test(id) && !VISION_MODEL.test(id))
  const strongTier = (id: string) => STRONG_TIERS.find(([pattern]) => pattern.test(id))?.[1] ?? 0
  const strong = best(chat.filter((id) => !FAST_MODEL.test(id)), strongTier) ?? best(chat)
  if (!strong) return {}
  const picks: Partial<Record<AiCapability, string>> = {
    STRONG_REASONING: strong,
    LONG_CONTEXT: strong,
    FAST_TEXT: best(chat.filter((id) => FAST_MODEL.test(id))) ?? strong,
    CODING: best(chat.filter((id) => CODING_MODEL.test(id)), strongTier) ?? strong,
  }
  const vision = best(availableModelIds.filter((id) => VISION_MODEL.test(id)))
  if (vision) picks.VISION = vision
  return picks
}

export function planAutoSetup(kind: ProviderKind, availableModelIds: readonly string[]): AutoSetupPlan {
  const available = new Set(availableModelIds)
  const resolve = (suggestion: SuggestedAiModel): string | null => {
    if (available.size === 0 || available.has(suggestion.modelId)) return suggestion.modelId
    /* Dated variants only: ming-image-0.1-design-layer is a different model, not a snapshot. */
    const dated = availableModelIds
      .filter((id) => id.startsWith(`${suggestion.modelId}-`) && /^\d/.test(id.slice(suggestion.modelId.length + 1)))
      .sort()
      .at(-1)
    if (dated) return dated
    return suggestion.capabilities.some((c) => UNLISTED_OK.includes(c)) ? suggestion.modelId : null
  }
  const usable = AI_PROVIDER_PRESETS[kind].suggestedModels.flatMap((suggestion) => {
    if (suggestion.autoSetup === false) return []
    const modelId = resolve(suggestion)
    return modelId ? [{ ...suggestion, modelId, capabilities: [...suggestion.capabilities] }] : []
  })
  /* A model's first capability is its main role (qwen-flash: Fast text), so
   * main roles win first; any model that also serves a capability fills gaps. */
  const routes: Partial<Record<AiCapability, string>> = {}
  for (const model of usable) {
    const main = model.capabilities.at(0)
    if (main) routes[main] ??= model.modelId
  }
  for (const model of usable) {
    for (const capability of model.capabilities) routes[capability] ??= model.modelId
  }
  /* Jobs still open are matched by name against the key's own list (text and vision only). */
  const allowed = AI_PROVIDER_PRESETS[kind].allowedCapabilities
  for (const [capability, modelId] of Object.entries(inferTextModels(availableModelIds)) as [AiCapability, string][]) {
    if (routes[capability] || (allowed && !allowed.includes(capability))) continue
    routes[capability] = modelId
    const known = usable.find((model) => model.modelId === modelId)
    if (known) {
      if (!known.capabilities.includes(capability)) known.capabilities.push(capability)
    } else {
      usable.push({ modelId, displayName: modelId, capabilities: [capability], supportsJsonSchema: false })
    }
  }
  const routed = new Set(Object.values(routes))
  return { models: usable.filter((model) => routed.has(model.modelId)), routes }
}

/**
 * SOURCE OF TRUTH KEYWORDS: canAutoSetup, set up for me availability
 *
 * WHAT:  Whether "Set up for me" is offered for a provider kind: it has
 *        recommended models, or it can serve text jobs that are matched from
 *        the key's own model list (Custom, OpenRouter, local servers).
 * WHERE: ProviderDialog (connect), provider rows in AiProvidersSettings.
 */
export function canAutoSetup(kind: ProviderKind): boolean {
  const preset = AI_PROVIDER_PRESETS[kind]
  return preset.suggestedModels.length > 0 || preset.allowedCapabilities === null
}

/**
 * SOURCE OF TRUTH KEYWORDS: AI_CAPABILITY_LABELS
 *
 * WHAT:  Human copy for each capability an agent can request (blueprint §23).
 */
export const AI_CAPABILITY_LABELS: Record<AiCapability, { label: string; description: string }> = {
  STRONG_REASONING: {
    label: 'Strong reasoning',
    description: 'Research, curriculum design, lesson writing, QA review',
  },
  FAST_TEXT: {
    label: 'Fast text',
    description: 'Quizzes, exercises, short transformations',
  },
  CODING: {
    label: 'Coding',
    description: 'Code demos, programming exercises and solutions',
  },
  LONG_CONTEXT: {
    label: 'Long context',
    description: 'Whole-course review and long source material',
  },
  TTS: {
    label: 'Narration (text to speech)',
    description: 'Voices every video scene; priced per 1M characters',
  },
  VISION: {
    label: 'Vision (read images)',
    description: 'Reads scanned book pages; needs a vision or OCR model',
  },
  IMAGE_GENERATION: {
    label: 'Illustrations (image generation)',
    description: 'Draws pictures for lecture videos; priced per image',
  },
}

/**
 * SOURCE OF TRUTH KEYWORDS: VOICE_CATALOG, voiceCatalogFor, VoiceCatalogEntry,
 *   narration voice ids, default voice, voice controls, CosyVoice, Kokoro,
 *   Qwen TTS, ElevenLabs, OpenAI voices
 *
 * WHAT:  What each TTS model family accepts: its built-in voice ids, the
 *        voice used when nothing was picked for it, and the controls it
 *        honours (speed range, style instructions). Providers that can list
 *        their own voices add to these at runtime (src/lib/ai/voices.ts).
 * WHY:   Voice ids are model specific (OpenAI "echo", Kokoro "af_heart",
 *        SiliconFlow "FunAudioLLM/CosyVoice2-0.5B:anna", ElevenLabs voice
 *        ids). Offering another model's names only produces "Invalid voice"
 *        errors, and showing a speed control the model ignores misleads.
 *        Supporting a new TTS family is one entry here; the last entry is
 *        the catch-all for OpenAI-style models.
 * WHERE: src/lib/ai/voices.ts (voice lists), resolveVoiceForModel and
 *        synthesizeSpeech (fallback voice, controls), NarrationVoiceForm.
 */
interface VoiceCatalogEntry {
  matches: (kind: ProviderKind, modelId: string) => boolean
  voices: (modelId: string) => VoiceOption[]
  defaultVoice: (modelId: string) => string
  controls: (modelId: string) => VoiceControls
}

const plainVoices = (ids: readonly string[], label: (id: string) => string = (id) => id): VoiceOption[] =>
  ids.map((id) => ({ id, label: label(id), description: null }))

const COSYVOICE_VOICES = ['alex', 'benjamin', 'charles', 'david', 'anna', 'bella', 'claire', 'diana'] as const
/* Qwen TTS (Alibaba Model Studio) system voices. */
const QWEN_TTS_VOICES = ['Cherry', 'Ethan', 'Serena', 'Chelsie', 'Jennifer', 'Ryan', 'Katerina', 'Elias'] as const
const KOKORO_VOICES = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'am_adam', 'am_michael', 'bf_emma', 'bm_george'] as const
const OPENAI_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'] as const
/* ElevenLabs premade voices every account can use; "George" is the default.
 * Shown when the key cannot list voices (no voices_read permission). */
const ELEVENLABS_PREMADE_VOICES: readonly VoiceOption[] = [
  { id: 'JBFqnCBsd6RMkjVDRZzb', label: 'George', description: 'british · male · premade' },
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Rachel', description: 'american · female · premade' },
  { id: 'EXAVITQu4vr4xnSDxMaL', label: 'Sarah', description: 'american · female · premade' },
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Adam', description: 'american · male · premade' },
  { id: 'nPczCjzI2devNBz1zQrb', label: 'Brian', description: 'american · male · premade' },
  { id: 'Xb7hH8MSUJpSbSDYk0k2', label: 'Alice', description: 'british · female · premade' },
  { id: 'onwK4e9ZLuTAKqWW03F9', label: 'Daniel', description: 'british · male · premade' },
  { id: 'XrExE9yKIg1WjnnlVkGX', label: 'Matilda', description: 'american · female · premade' },
]
const ELEVENLABS_DEFAULT_VOICE = 'JBFqnCBsd6RMkjVDRZzb'

const FULL_SPEED = { min: VOICE_SPEED_LIMITS.min, max: VOICE_SPEED_LIMITS.max } as const

const VOICE_CATALOG: readonly VoiceCatalogEntry[] = [
  {
    /* Voices are listed live from the account (cloned and designed ones too);
     * the premade ones stand in when the key may not list them. */
    matches: (kind) => kind === 'ELEVENLABS',
    voices: () => [...ELEVENLABS_PREMADE_VOICES],
    defaultVoice: () => ELEVENLABS_DEFAULT_VOICE,
    controls: () => ({ speed: { min: VOICE_SPEED_LIMITS.min, max: 1.2 }, style: false }),
  },
  {
    /* SiliconFlow CosyVoice: system voices are "<model>:<name>". */
    matches: (_kind, modelId) => /cosyvoice/i.test(modelId),
    voices: (modelId) => COSYVOICE_VOICES.map((name) => ({ id: `${modelId}:${name}`, label: name, description: null })),
    defaultVoice: (modelId) => `${modelId}:${COSYVOICE_VOICES[0]}`,
    controls: () => ({ speed: FULL_SPEED, style: false }),
  },
  {
    /* Alibaba's native speech API takes neither speed nor style. */
    matches: (_kind, modelId) => /^qwen.*tts/i.test(modelId),
    voices: () => plainVoices(QWEN_TTS_VOICES),
    defaultVoice: () => QWEN_TTS_VOICES[0],
    controls: () => ({ speed: null, style: false }),
  },
  {
    matches: (_kind, modelId) => /kokoro/i.test(modelId),
    voices: () => plainVoices(KOKORO_VOICES, (id) => id.slice(3)),
    defaultVoice: () => KOKORO_VOICES[0],
    controls: () => ({ speed: FULL_SPEED, style: false }),
  },
  {
    /* OpenAI and OpenAI-style models; only the older tts-1 family drops style. */
    matches: () => true,
    voices: () => plainVoices(OPENAI_VOICES),
    defaultVoice: () => OPENAI_VOICES[0],
    controls: (modelId) => ({ speed: FULL_SPEED, style: !/^tts-1/i.test(modelId) }),
  },
]

/**
 * SOURCE OF TRUTH KEYWORDS: voiceCatalogFor
 *
 * WHAT:  The catalog entry for one TTS model, resolved to plain data.
 */
export function voiceCatalogFor(
  kind: ProviderKind,
  modelId: string
): { voices: VoiceOption[]; defaultVoice: string; controls: VoiceControls } {
  const entry = VOICE_CATALOG.find((e) => e.matches(kind, modelId)) ?? VOICE_CATALOG[VOICE_CATALOG.length - 1]
  if (!entry) return { voices: [], defaultVoice: OPENAI_VOICES[0], controls: { speed: FULL_SPEED, style: true } }
  return { voices: entry.voices(modelId), defaultVoice: entry.defaultVoice(modelId), controls: entry.controls(modelId) }
}

/**
 * SOURCE OF TRUTH KEYWORDS: modelVoicesFor, model voice list, AiModel.voices,
 *   saved voice ids, starter voices, VoiceCatalogSource, default voice per model
 *
 * WHAT:  The voices one TTS model speaks with, from its own saved voice ids
 *        (AiModel.voices). The catalog is only the starter list for a model
 *        with none saved, and only lends labels ("anna" for "<model>:anna").
 * WHY:   Voices belong to the model the workspace set up, not to code, so a
 *        new voice is a model edit and never a deploy.
 * WHERE: listModelVoices (gateway), resolveVoiceForModel, ModelDialog (starter
 *        voices for a new Narration model).
 */
export function modelVoicesFor(
  kind: ProviderKind,
  modelId: string,
  savedIds: readonly string[]
): { voices: VoiceOption[]; defaultVoice: string; source: Exclude<VoiceCatalogSource, 'live'> } {
  const catalog = voiceCatalogFor(kind, modelId)
  if (savedIds.length === 0) return { voices: catalog.voices, defaultVoice: catalog.defaultVoice, source: 'catalog' }
  const voices = savedIds.map((id) => catalog.voices.find((v) => v.id === id) ?? { id, label: id, description: null })
  const defaultVoice = savedIds.includes(catalog.defaultVoice) ? catalog.defaultVoice : (savedIds[0] ?? catalog.defaultVoice)
  return { voices, defaultVoice, source: 'model' }
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveVoiceForModel, fallback voice, voice per
 *   model, SavedNarrationVoice, aiModelId, VoiceProfile lookup
 *
 * WHAT:  The voice, speed and style one TTS model speaks with: its own saved
 *        profile, else a profile saved before voices were per model, else the
 *        model's default voice (from its own voice list) with the default
 *        speed and style.
 * WHY:   Voice ids only work on their own model. Rerouting Narration or
 *        falling back to another provider must not send it a foreign id.
 * WHERE: synthesizeSpeech (gateway), NarrationVoiceForm (form defaults).
 */
export function resolveVoiceForModel(
  model: { id: string; modelId: string; kind: ProviderKind; voices: readonly string[] },
  profiles: readonly SavedNarrationVoice[]
): Omit<SavedNarrationVoice, 'aiModelId'> {
  const own = profiles.find((p) => p.aiModelId === model.id) ?? profiles.find((p) => p.aiModelId === null)
  if (own) return { voice: own.voice, speed: own.speed, instructions: own.instructions }
  const { defaultVoice } = modelVoicesFor(model.kind, model.modelId, model.voices)
  return { voice: defaultVoice, speed: DEFAULT_VOICE.speed, instructions: DEFAULT_VOICE.instructions }
}

export const DEFAULT_VOICE = { voice: 'alloy', speed: 1, instructions: 'Warm, clear and friendly online instructor.' } as const

/**
 * SOURCE OF TRUTH KEYWORDS: ROUTING_PRESET_LABELS
 *
 * WHAT:  Copy for the one-click routing presets. The selection rules
 *        themselves live in buildPresetRoutes (src/lib/ai/routing.ts).
 */
export const ROUTING_PRESET_LABELS: Record<RoutingPreset, { label: string; description: string }> = {
  ECONOMY: {
    label: 'Economy',
    description: 'Cheapest capable model for every capability',
  },
  BALANCED: {
    label: 'Balanced',
    description: 'Premium models for reasoning and code, cheapest for the rest',
  },
  BEST_QUALITY: {
    label: 'Best quality',
    description: 'Most capable (highest-priced) model everywhere',
  },
}
