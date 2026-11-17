import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: splitSpeechText, TTS chunking, sentence chunks,
 *   narration text limit, speech request size
 *
 * WHAT:  Splits narration into sentence-sized chunks of at most `maxChars`;
 *        a single sentence longer than that is cut on a space.
 * WHY:   Speech APIs cap characters per request (DashScope, ElevenLabs), so
 *        long scenes are voiced in pieces and joined by the adapter.
 * WHERE: adapters/dashscope.ts, adapters/elevenlabs.ts.
 */
export function splitSpeechText(text: string, maxChars: number): string[] {
  const sentences = text.trim().split(/(?<=[.!?。！？])\s+/).filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > maxChars) {
      chunks.push(current)
      current = sentence
    } else {
      current = current ? `${current} ${sentence}` : sentence
    }
  }
  if (current) chunks.push(current)
  return chunks.flatMap((chunk) =>
    chunk.length <= maxChars ? [chunk] : chunk.match(new RegExp(`.{1,${maxChars}}(\\s|$)`, 'g')) ?? [chunk]
  )
}
