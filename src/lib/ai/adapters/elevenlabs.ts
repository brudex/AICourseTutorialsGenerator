import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: createElevenLabsSpeech, listElevenLabsVoices,
 *   listElevenLabsModels, ElevenLabs TTS, xi-api-key, text-to-speech,
 *   cloned voices, ElevenLabs adapter
 *
 * WHAT:  Narration through ElevenLabs' own API: speech (POST
 *        /text-to-speech/{voice_id}), the account's voices (GET /voices,
 *        premade, cloned and designed) and its speech models (GET /models,
 *        which doubles as the connection test).
 * WHY:   ElevenLabs is not OpenAI shaped: the key goes in `xi-api-key`, the
 *        voice is in the path and the model list is a bare array. Long text
 *        is voiced in chunks with the neighbouring text passed along so the
 *        delivery stays continuous; MP3 chunks join by concatenation. Every
 *        call passes the SSRF guard. Errors leave only as AiGatewayError.
 * WHERE: src/lib/ai/gateway.ts (synthesizeSpeech, connection checks) and
 *        src/lib/ai/voices.ts (voice list) for ELEVENLABS providers.
 */

import {
  elevenLabsErrorSchema,
  elevenLabsModelsResponseSchema,
  elevenLabsVoicesResponseSchema,
  type VoiceOption,
} from '@/lib/types'
import { AiGatewayError, aiErrorFromStatus, toAiGatewayError } from '../errors'
import { assertProviderUrlAllowed } from '../url-guard'
import type { ProviderEndpoint } from './openai-compatible'
import { splitSpeechText } from './speech-text'

const SPEECH_TIMEOUT_MS = 120_000
const LIST_TIMEOUT_MS = 15_000
/* Characters per request; inside every current model's limit. */
const CHUNK_CHARS = 4_500
/* Neighbouring text sent for continuity is capped to keep requests small. */
const CONTEXT_CHARS = 500

async function elevenLabsFetch(endpoint: ProviderEndpoint, path: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  await assertProviderUrlAllowed(endpoint.baseUrl)
  const response = await fetch(`${endpoint.baseUrl.replace(/\/+$/, '')}${path}`, {
    ...init,
    headers: { 'xi-api-key': endpoint.apiKey ?? '', 'content-type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (response.ok) return response
  const parsed = elevenLabsErrorSchema.safeParse(await response.json().catch(() => null))
  const detail = parsed.success ? (typeof parsed.data.detail === 'string' ? parsed.data.detail : parsed.data.detail.message) : null
  throw aiErrorFromStatus(response.status, detail ?? `HTTP ${response.status}`)
}

/**
 * SOURCE OF TRUTH KEYWORDS: createElevenLabsSpeech
 *
 * WHAT:  MP3 narration for `input` in one ElevenLabs voice. Speed is sent
 *        only when it differs from 1, so the voice's own tuning stays in
 *        charge otherwise.
 */
export async function createElevenLabsSpeech(
  endpoint: ProviderEndpoint,
  params: { model: string; voice: string; input: string; speed: number }
): Promise<Uint8Array> {
  try {
    const chunks = splitSpeechText(params.input, CHUNK_CHARS)
    const parts: Uint8Array[] = []
    for (const [index, text] of chunks.entries()) {
      const response = await elevenLabsFetch(
        endpoint,
        `/text-to-speech/${encodeURIComponent(params.voice)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          body: JSON.stringify({
            text,
            model_id: params.model,
            ...(params.speed !== 1 ? { voice_settings: { speed: params.speed } } : {}),
            ...(index > 0 ? { previous_text: chunks[index - 1]?.slice(-CONTEXT_CHARS) } : {}),
            ...(index < chunks.length - 1 ? { next_text: chunks[index + 1]?.slice(0, CONTEXT_CHARS) } : {}),
          }),
        },
        SPEECH_TIMEOUT_MS
      )
      parts.push(new Uint8Array(await response.arrayBuffer()))
    }
    if (parts.length === 0) throw new AiGatewayError('invalid_output', 'The voice provider returned no audio.')
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
    parts.reduce((offset, part) => (out.set(part, offset), offset + part.byteLength), 0)
    return out
  } catch (error) {
    throw toAiGatewayError(error)
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: listElevenLabsVoices
 *
 * WHAT:  Every voice the key can use, labelled by accent, gender and kind
 *        (premade, cloned, generated, professional).
 */
export async function listElevenLabsVoices(endpoint: ProviderEndpoint): Promise<VoiceOption[]> {
  try {
    const response = await elevenLabsFetch(endpoint, '/voices', { method: 'GET' }, LIST_TIMEOUT_MS)
    const parsed = elevenLabsVoicesResponseSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) throw new AiGatewayError('invalid_output', 'ElevenLabs returned a voice list this app cannot read.')
    return parsed.data.voices.map((voice) => {
      const details = [voice.labels?.['accent'], voice.labels?.['gender'], voice.category].filter((part): part is string => Boolean(part))
      return { id: voice.voice_id, label: voice.name ?? voice.voice_id, description: details.length > 0 ? details.join(' · ') : null }
    })
  } catch (error) {
    throw toAiGatewayError(error)
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: listElevenLabsModels
 *
 * WHAT:  The speech model ids the key can use; proves URL + key work.
 */
export async function listElevenLabsModels(endpoint: ProviderEndpoint): Promise<string[]> {
  try {
    const response = await elevenLabsFetch(endpoint, '/models', { method: 'GET' }, LIST_TIMEOUT_MS)
    const parsed = elevenLabsModelsResponseSchema.safeParse(await response.json().catch(() => null))
    if (!parsed.success) throw new AiGatewayError('invalid_output', 'ElevenLabs returned a model list this app cannot read.')
    return parsed.data
      .filter((model) => model.can_do_text_to_speech !== false)
      .map((model) => model.model_id)
      .sort((a, b) => a.localeCompare(b))
  } catch (error) {
    throw toAiGatewayError(error)
  }
}
