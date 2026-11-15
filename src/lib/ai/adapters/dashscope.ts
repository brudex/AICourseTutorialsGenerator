import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: createDashScopeSpeech, DashScope TTS, qwen3-tts,
 *   Alibaba narration, multimodal-generation, dashScopeApiBase, WAV join
 *
 * WHAT:  Narration through Alibaba Model Studio's native speech API (Qwen TTS
 *        models such as qwen3-tts-flash). Long text is sent in sentence-sized
 *        chunks and the returned WAV files are joined into one.
 * WHY:   DashScope's OpenAI-compatible mode has no /audio/speech, so Alibaba
 *        voices need their own call. The provider row keeps its compatible
 *        base URL (used for text); the native API base is derived from it, so
 *        one key and one provider serve both. The reply holds a short-lived
 *        download URL, fetched only from Alibaba's own storage hosts.
 *        Speed and style instructions are not supported by these models and
 *        are ignored.
 * WHERE: synthesizeSpeech (src/lib/ai/gateway.ts) for ALIBABA providers.
 */

import { dashScopeImageResponseSchema, dashScopeSpeechResponseSchema } from '@/lib/types'
import { AiGatewayError, aiErrorFromStatus, toAiGatewayError } from '../errors'
import { assertProviderUrlAllowed } from '../url-guard'
import type { ProviderEndpoint } from './openai-compatible'

const SPEECH_TIMEOUT_MS = 120_000
/* Characters per request; well inside the model's input limit. */
const CHUNK_CHARS = 1_000
const AUDIO_HOST_PATTERN = /\.aliyuncs\.com$/i

/** `…/compatible-mode/v1` → `…/api/v1` (the native API on the same host). */
export function dashScopeApiBase(baseUrl: string): string {
  const url = new URL(baseUrl)
  url.pathname = '/api/v1'
  return url.toString().replace(/\/$/, '')
}

function splitText(text: string): string[] {
  const sentences = text.split(/(?<=[.!?。！？])\s+/).filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > CHUNK_CHARS) {
      chunks.push(current)
      current = sentence
    } else {
      current = current ? `${current} ${sentence}` : sentence
    }
  }
  if (current) chunks.push(current)
  /* A single sentence longer than a chunk is cut on a space. */
  return chunks.flatMap((chunk) =>
    chunk.length <= CHUNK_CHARS ? [chunk] : chunk.match(new RegExp(`.{1,${CHUNK_CHARS}}(\\s|$)`, 'g')) ?? [chunk]
  )
}

interface WavParts {
  format: Uint8Array
  data: Uint8Array
}

/* The `fmt ` and `data` chunks of a PCM WAV file. */
function readWav(bytes: Uint8Array): WavParts {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new AiGatewayError('invalid_output', 'The voice provider returned audio that is not WAV.')
  let format: Uint8Array | null = null
  let offset = 12
  while (offset + 8 <= bytes.byteLength) {
    const id = tag(offset)
    const size = Math.min(view.getUint32(offset + 4, true), bytes.byteLength - offset - 8)
    const body = bytes.subarray(offset + 8, offset + 8 + size)
    if (id === 'fmt ') format = body
    if (id === 'data' && format) return { format, data: body }
    offset += 8 + size + (size % 2)
  }
  throw new AiGatewayError('invalid_output', 'The voice provider returned an incomplete WAV file.')
}

/* Joins WAV files that share one PCM format into a single file. */
function joinWav(files: readonly Uint8Array[]): Uint8Array {
  const first = files[0]
  if (!first) throw new AiGatewayError('invalid_output', 'The voice provider returned no audio.')
  if (files.length === 1) return first
  const parts = files.map(readWav)
  const format = parts[0]?.format ?? new Uint8Array()
  const dataSize = parts.reduce((sum, part) => sum + part.data.byteLength, 0)
  const out = new Uint8Array(12 + 8 + format.byteLength + 8 + dataSize)
  const view = new DataView(out.buffer)
  const writeTag = (offset: number, value: string) => out.set([...value].map((c) => c.charCodeAt(0)), offset)
  writeTag(0, 'RIFF')
  view.setUint32(4, out.byteLength - 8, true)
  writeTag(8, 'WAVE')
  writeTag(12, 'fmt ')
  view.setUint32(16, format.byteLength, true)
  out.set(format, 20)
  const dataOffset = 20 + format.byteLength
  writeTag(dataOffset, 'data')
  view.setUint32(dataOffset + 4, dataSize, true)
  let cursor = dataOffset + 8
  for (const part of parts) {
    out.set(part.data, cursor)
    cursor += part.data.byteLength
  }
  return out
}

async function speakChunk(endpoint: ProviderEndpoint, params: { model: string; voice: string; text: string }): Promise<Uint8Array> {
  const response = await fetch(`${dashScopeApiBase(endpoint.baseUrl)}/services/aigc/multimodal-generation/generation`, {
    method: 'POST',
    headers: { authorization: `Bearer ${endpoint.apiKey ?? ''}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: params.model, input: { text: params.text, voice: params.voice, language_type: 'Auto' } }),
    signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
  })
  const parsed = dashScopeSpeechResponseSchema.safeParse(await response.json().catch(() => null))
  const reply = parsed.success ? parsed.data : null
  if (!response.ok || !reply?.output) {
    throw aiErrorFromStatus(response.ok ? null : response.status, reply?.message ?? reply?.code ?? `HTTP ${response.status}`)
  }

  const audioUrl = new URL(reply.output.audio.url)
  if (!AUDIO_HOST_PATTERN.test(audioUrl.hostname)) {
    throw new AiGatewayError('invalid_output', 'The voice provider returned audio from an unexpected host.')
  }
  const audio = await fetch(audioUrl, { signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS) })
  if (!audio.ok) throw aiErrorFromStatus(audio.status, 'Could not download the narration audio.')
  return new Uint8Array(await audio.arrayBuffer())
}

export async function createDashScopeSpeech(
  endpoint: ProviderEndpoint,
  params: { model: string; voice: string; input: string }
): Promise<Uint8Array> {
  await assertProviderUrlAllowed(endpoint.baseUrl)
  try {
    const files: Uint8Array[] = []
    for (const text of splitText(params.input.trim())) files.push(await speakChunk(endpoint, { ...params, text }))
    return joinWav(files)
  } catch (error) {
    throw toAiGatewayError(error)
  }
}

const IMAGE_TIMEOUT_MS = 300_000

/**
 * SOURCE OF TRUTH KEYWORDS: createDashScopeImage, qwen-image, Alibaba image
 *   generation, lecture illustration
 *
 * WHAT:  One image from an Alibaba Qwen-Image model through the native
 *        multimodal-generation API (the same host and path as narration),
 *        downloaded at once because the returned link expires in 24 hours.
 * WHY:   Prompt rewriting stays on (prompt_extend) for richer pictures;
 *        watermark off; the image host is checked to be Alibaba's storage.
 * WHERE: generateImage in src/lib/ai/gateway.ts for ALIBABA providers.
 */
export async function createDashScopeImage(
  endpoint: ProviderEndpoint,
  params: { model: string; prompt: string; negativePrompt: string; size: string }
): Promise<Uint8Array> {
  await assertProviderUrlAllowed(endpoint.baseUrl)
  try {
    const response = await fetch(`${dashScopeApiBase(endpoint.baseUrl)}/services/aigc/multimodal-generation/generation`, {
      method: 'POST',
      headers: { authorization: `Bearer ${endpoint.apiKey ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: params.model,
        input: { messages: [{ role: 'user', content: [{ text: params.prompt }] }] },
        parameters: { size: params.size, n: 1, prompt_extend: true, watermark: false, negative_prompt: params.negativePrompt },
      }),
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    })
    const parsed = dashScopeImageResponseSchema.safeParse(await response.json().catch(() => null))
    const reply = parsed.success ? parsed.data : null
    const imageUrl = reply?.output?.choices[0]?.message.content.find((part) => part.image)?.image
    if (!response.ok || !imageUrl) {
      throw aiErrorFromStatus(response.ok ? null : response.status, reply?.message ?? reply?.code ?? `HTTP ${response.status}`)
    }
    const url = new URL(imageUrl)
    if (!AUDIO_HOST_PATTERN.test(url.hostname)) {
      throw new AiGatewayError('invalid_output', 'The image provider returned a picture from an unexpected host.')
    }
    const image = await fetch(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS) })
    if (!image.ok) throw aiErrorFromStatus(image.status, 'Could not download the generated image.')
    return new Uint8Array(await image.arrayBuffer())
  } catch (error) {
    throw toAiGatewayError(error)
  }
}
