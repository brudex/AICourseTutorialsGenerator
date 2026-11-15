/**
 * SOURCE OF TRUTH KEYWORDS: AI_PROVIDER_PRESETS, AiProviderPreset,
 *   SuggestedAiModel, AI_CAPABILITY_LABELS, ProviderKind, baseUrl presets,
 *   ROUTING_PRESET_LABELS
 *
 * WHAT:  Display metadata and default base URLs for every ProviderKind, the
 *        model ids we suggest when connecting one, and human labels for
 *        capabilities and routing presets.
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
import type { RoutingPreset } from '@/lib/types'

export interface SuggestedAiModel {
  modelId: string
  displayName: string
  capabilities: AiCapability[]
  supportsJsonSchema: boolean
}

export interface AiProviderPreset {
  label: string
  description: string
  defaultBaseUrl: string
  /** Alternate regional endpoints shown as hints under the URL field. */
  alternateBaseUrls: readonly string[]
  apiKeyRequired: boolean
  pricingUrl: string | null
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
    suggestedModels: [
      /* qwen-plus first: it is the model the planning agents are proven on.
       * The legacy qwen-max returned nested curriculum fields as null or
       * strings even with json_schema (desktop run, 2026-11-13), so it is
       * no longer suggested for strong reasoning. */
      { modelId: 'qwen-plus', displayName: 'Qwen Plus', capabilities: ['STRONG_REASONING', 'FAST_TEXT', 'LONG_CONTEXT'], supportsJsonSchema: true },
      { modelId: 'qwen-max', displayName: 'Qwen Max (legacy)', capabilities: ['LONG_CONTEXT'], supportsJsonSchema: false },
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
    suggestedModels: [
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
    suggestedModels: [],
  },
  LOCAL: {
    label: 'Local model',
    description: 'Ollama, LM Studio, vLLM or any local OpenAI-compatible server.',
    defaultBaseUrl: 'http://localhost:11434/v1',
    alternateBaseUrls: ['http://localhost:1234/v1'],
    apiKeyRequired: false,
    pricingUrl: null,
    suggestedModels: [],
  },
  CUSTOM: {
    label: 'Custom (OpenAI-compatible)',
    description: 'Any other endpoint that speaks the OpenAI chat-completions protocol.',
    defaultBaseUrl: 'https://',
    alternateBaseUrls: [],
    apiKeyRequired: true,
    pricingUrl: null,
    suggestedModels: [],
  },
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
 * SOURCE OF TRUTH KEYWORDS: VOICE_SUGGESTIONS, voiceSuggestionsFor,
 *   VOICE_CATALOG, narration voice ids, CosyVoice, Kokoro, Qwen TTS
 *
 * WHAT:  One-click voice choices for the model routed to Narration. Each
 *        catalog entry matches a TTS model id and lists the voice ids that
 *        model accepts; unknown models get the OpenAI names. Any id the
 *        provider supports can still be typed.
 * WHY:   Voice ids are model specific (OpenAI "echo", Kokoro "af_heart",
 *        SiliconFlow "FunAudioLLM/CosyVoice2-0.5B:anna"). Offering another
 *        model's names only produces "Invalid voice" errors. Supporting a new
 *        TTS model is one entry here.
 * WHERE: NarrationVoiceForm.
 */
export const VOICE_SUGGESTIONS = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'] as const

interface VoiceCatalogEntry {
  matches: (modelId: string) => boolean
  voices: (modelId: string) => ReadonlyArray<{ id: string; label: string }>
}

const COSYVOICE_VOICES = ['alex', 'benjamin', 'charles', 'david', 'anna', 'bella', 'claire', 'diana'] as const
/* Qwen TTS (Alibaba Model Studio) system voices. */
const QWEN_TTS_VOICES = ['Cherry', 'Ethan', 'Serena', 'Chelsie', 'Jennifer', 'Ryan', 'Katerina', 'Elias'] as const
const KOKORO_VOICES = ['af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'am_adam', 'am_michael', 'bf_emma', 'bm_george'] as const

const VOICE_CATALOG: readonly VoiceCatalogEntry[] = [
  {
    /* SiliconFlow CosyVoice: system voices are "<model>:<name>". */
    matches: (modelId) => /cosyvoice/i.test(modelId),
    voices: (modelId) => COSYVOICE_VOICES.map((name) => ({ id: `${modelId}:${name}`, label: name })),
  },
  {
    matches: (modelId) => /^qwen.*tts/i.test(modelId),
    voices: () => QWEN_TTS_VOICES.map((id) => ({ id, label: id })),
  },
  {
    matches: (modelId) => /kokoro/i.test(modelId),
    voices: () => KOKORO_VOICES.map((id) => ({ id, label: id.slice(3) })),
  },
]

export function voiceSuggestionsFor(modelId: string | null): ReadonlyArray<{ id: string; label: string }> {
  const entry = modelId ? VOICE_CATALOG.find((e) => e.matches(modelId)) : undefined
  return entry && modelId ? entry.voices(modelId) : VOICE_SUGGESTIONS.map((id) => ({ id, label: id }))
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
