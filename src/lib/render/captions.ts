/**
 * SOURCE OF TRUTH KEYWORDS: buildWebVtt, captions, WebVTT, caption cues,
 *   CaptionScene
 *
 * WHAT:  Builds a lecture's WebVTT captions from its scenes' narration and
 *        MEASURED audio lengths: each scene is split into sentence cues whose
 *        times are proportional to their share of the scene's characters;
 *        long sentences are split at commas so no cue exceeds ~84 chars.
 * WHY:   TTS providers return audio without word timings; character-
 *        proportional timing within a measured scene stays within a fraction
 *        of a second of the voice, which is how most generated captions are
 *        timed. Pure function — no I/O — so it is trivially testable and
 *        reusable by the video renderer (step 8) for burned-in captions.
 * WHERE: Narrator agent (src/lib/agents/narrator.ts); splitCues also drives
 *        the slideshow player's on-screen captions.
 */

export interface CaptionScene {
  narration: string
  audioMs: number
  pauseAfterMs: number
}

const MAX_CUE_CHARS = 84

function timestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms))
  const h = Math.floor(total / 3_600_000)
  const m = Math.floor((total % 3_600_000) / 60_000)
  const s = Math.floor((total % 60_000) / 1000)
  const milli = total % 1000
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(milli, 3)}`
}

/** Narration split into caption-sized cues (sentences; long ones at commas). */
export function splitCues(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean)
  return sentences.flatMap((sentence) => {
    if (sentence.length <= MAX_CUE_CHARS) return [sentence]
    const parts: string[] = []
    let current = ''
    for (const piece of sentence.split(/(?<=,)\s+/)) {
      if (current && (current + ' ' + piece).length > MAX_CUE_CHARS) {
        parts.push(current)
        current = piece
      } else {
        current = current ? `${current} ${piece}` : piece
      }
    }
    if (current) parts.push(current)
    return parts
  })
}

export function buildWebVtt(scenes: readonly CaptionScene[]): string {
  const lines: string[] = ['WEBVTT', '']
  let offset = 0
  let index = 1
  for (const scene of scenes) {
    const cues = splitCues(scene.narration)
    const totalChars = cues.reduce((sum, c) => sum + c.length, 0) || 1
    let cursor = offset
    for (const cue of cues) {
      const length = (cue.length / totalChars) * scene.audioMs
      lines.push(String(index++), `${timestamp(cursor)} --> ${timestamp(cursor + length)}`, cue, '')
      cursor += length
    }
    offset += scene.audioMs + scene.pauseAfterMs
  }
  return lines.join('\n')
}
