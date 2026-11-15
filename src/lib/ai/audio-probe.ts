import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: probeAudio, audio duration, audio container
 *   detection, music-metadata
 *
 * WHAT:  Reads the real container and duration of synthesized audio bytes.
 * WHY:   Video timing is built on MEASURED narration length (docs/11 §3), and
 *        providers do not always honour the requested format — so the bytes
 *        are inspected rather than trusted. Unreadable or empty audio is an
 *        `invalid_output` gateway error (retryable), never a silent 0 ms scene.
 * WHERE: src/lib/ai/gateway.ts (synthesizeSpeech).
 */

import { parseBuffer } from 'music-metadata'

import type { AiSpeechResult } from '@/lib/types'
import { AiGatewayError } from './errors'

const CONTAINERS: ReadonlyArray<{ match: RegExp; mimeType: AiSpeechResult['mimeType']; extension: AiSpeechResult['extension'] }> = [
  { match: /mpeg|mp3/i, mimeType: 'audio/mpeg', extension: 'mp3' },
  { match: /wav|wave/i, mimeType: 'audio/wav', extension: 'wav' },
  { match: /ogg|opus/i, mimeType: 'audio/ogg', extension: 'ogg' },
  { match: /aac|adts|mp4|m4a/i, mimeType: 'audio/aac', extension: 'aac' },
  { match: /flac/i, mimeType: 'audio/flac', extension: 'flac' },
]

export async function probeAudio(
  audio: Uint8Array
): Promise<Pick<AiSpeechResult, 'mimeType' | 'extension' | 'durationMs'>> {
  if (audio.byteLength === 0) throw new AiGatewayError('invalid_output', 'The voice provider returned empty audio.')
  let metadata
  try {
    metadata = await parseBuffer(audio, undefined, { duration: true })
  } catch {
    throw new AiGatewayError('invalid_output', 'The voice provider returned audio that could not be read.')
  }
  const container = `${metadata.format.container ?? ''} ${metadata.format.codec ?? ''}`
  const kind = CONTAINERS.find((c) => c.match.test(container))
  const seconds = metadata.format.duration ?? 0
  if (!kind || seconds <= 0) {
    throw new AiGatewayError('invalid_output', 'The voice provider returned audio in an unsupported format.')
  }
  return { mimeType: kind.mimeType, extension: kind.extension, durationMs: Math.round(seconds * 1000) }
}
