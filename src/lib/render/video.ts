import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: renderLectureVideo, FFmpeg, lecture MP4,
 *   VideoSceneInput, ffmpegPath, videoRenderConcurrency
 *
 * WHAT:  Assembles a lecture MP4 from its scenes: each scene's 1920×1080 still
 *        is shown for exactly its measured duration with short fades; each
 *        scene's narration is padded with silence to that same duration;
 *        the picture segments are joined losslessly, the padded narration is
 *        joined as one PCM track and encoded once, the WebVTT captions are
 *        embedded as a subtitle track, and the file is web-optimised
 *        (+faststart) so playback starts before it fully downloads. The
 *        result is then verified: its duration must match the scene timeline
 *        and every caption must fall inside it.
 * WHY:   Deterministic rendering (blueprint §16, decision O2): FFmpeg only,
 *        no animation licence needed; every input (still, audio, duration)
 *        already exists from steps 6–7. Segments share identical encoder
 *        settings, so the final join is a stream copy (fast, no quality loss).
 *        Scenes without narration get silent audio for their estimated
 *        length, so a course without a TTS model still gets watchable video.
 *        Encoding is CPU-heavy: a per-process semaphore caps concurrent
 *        renders (videoRenderConcurrency portal setting, default 1) regardless of how many
 *        tasks the worker runs. Uses the bundled ffmpeg-static binary unless
 *        the ffmpegPath portal setting points elsewhere.
 *        Sync (video-tutorial-maker rules): scene durations are rounded to
 *        whole frames first, so picture and sound use the identical
 *        timeline; narration is padded per scene to that duration before
 *        joining, and audio is encoded once for the whole lecture (AAC
 *        segments joined by stream copy each add encoder priming, which
 *        drifts the voice later on every scene).
 * WHERE: Video renderer agent (src/lib/agents/video-renderer.ts).
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { parseBuffer } from 'music-metadata'

import { SLIDE_SIZE } from '@/lib/config/slide-theme'
import { platformSettingNumber, platformSettingText } from '@/lib/platform-settings'

export interface VideoSceneInput {
  still: Uint8Array
  audio: { bytes: Uint8Array; extension: string } | null
  durationMs: number
}

const FPS = 30
const FADE_SECONDS = 0.25
const FFMPEG_TIMEOUT_MS = 15 * 60_000
const AUDIO_RATE = 48_000
/* Allowed gap between the rendered file and the scene timeline. */
const SYNC_TOLERANCE_MS = 250

function ffmpegPath(): string {
  return (
    platformSettingText('ffmpegPath') ||
    path.join(process.cwd(), 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  )
}

/* Per-process render slots. The limit is read on every acquire, so a change
 * in portal settings applies to the next render; a woken waiter re-checks. */
let active = 0
const waiting: Array<() => void> = []

async function withRenderSlot<T>(work: () => Promise<T>): Promise<T> {
  while (active >= platformSettingNumber('videoRenderConcurrency')) {
    await new Promise<void>((resolve) => waiting.push(resolve))
  }
  active++
  try {
    return await work()
  } finally {
    active--
    waiting.shift()?.()
  }
}

function runFfmpeg(args: readonly string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-4_000)
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), FFMPEG_TIMEOUT_MS)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(new Error(`Could not start FFmpeg (${error.message}). Install it or set the FFmpeg path in portal settings under Rendering.`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg failed (exit ${code}): ${stderr.trim().split('\n').slice(-3).join(' ')}`))
    })
  })
}

/* Scene length in whole frames (at least half a second). */
function sceneFrames(ms: number): number {
  return Math.max(Math.round((Math.max(ms, 500) * FPS) / 1000), 1)
}

function concatList(files: readonly string[]): string {
  return files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n')
}

/* Last caption end time in ms; NaN if any timestamp is malformed. */
function lastCaptionEndMs(vtt: string): number {
  let last = 0
  for (const match of vtt.matchAll(/-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/g)) {
    const [, h, m, sec, ms] = match
    last = Math.max(last, Number(h) * 3_600_000 + Number(m) * 60_000 + Number(sec) * 1000 + Number(ms))
  }
  return /NaN/.test(vtt) ? Number.NaN : last
}

/**
 * SOURCE OF TRUTH KEYWORDS: verifyLectureVideo, render verification, A/V sync check
 * WHAT:  Fails the render when the MP4's duration is off the scene timeline
 *        or a caption is malformed or runs past the end.
 * WHY:   A silent sync bug ships to every learner; failing the task makes it
 *        visible and retryable instead.
 */
async function verifyLectureVideo(mp4: Uint8Array, expectedMs: number, captionsVtt: string | null): Promise<void> {
  const metadata = await parseBuffer(mp4, { mimeType: 'video/mp4' }, { duration: true })
  const actualMs = Math.round((metadata.format.duration ?? 0) * 1000)
  if (Math.abs(actualMs - expectedMs) > SYNC_TOLERANCE_MS) {
    throw new Error(`The rendered lecture is ${actualMs} ms long but its scenes add up to ${expectedMs} ms.`)
  }
  if (captionsVtt) {
    const captionEnd = lastCaptionEndMs(captionsVtt)
    if (Number.isNaN(captionEnd)) throw new Error('The lecture captions contain an invalid timestamp.')
    if (captionEnd > expectedMs + SYNC_TOLERANCE_MS) {
      throw new Error(`The captions run to ${captionEnd} ms, past the end of the lecture (${expectedMs} ms).`)
    }
  }
}

export async function renderLectureVideo(input: {
  scenes: readonly VideoSceneInput[]
  captionsVtt: string | null
  /** ISO 639-2 code for the subtitle track (e.g. `eng`). */
  captionLanguage: string
}): Promise<{ mp4: Uint8Array; durationMs: number }> {
  if (input.scenes.length === 0) throw new Error('A lecture needs at least one scene to render.')

  return withRenderSlot(async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'lecture-'))
    try {
      const segments: string[] = []
      const tracks: string[] = []
      let expectedFrames = 0
      for (const [i, scene] of input.scenes.entries()) {
        const still = path.join(dir, `still-${i}.png`)
        await writeFile(still, scene.still)
        const audio = scene.audio ? path.join(dir, `audio-${i}.${scene.audio.extension}`) : null
        if (scene.audio && audio) await writeFile(audio, scene.audio.bytes)

        const frames = sceneFrames(scene.durationMs)
        expectedFrames += frames
        const duration = (frames / FPS).toFixed(6)
        const fade = Math.min(FADE_SECONDS, frames / FPS / 4)
        const segment = path.join(dir, `segment-${i}.mp4`)
        await runFfmpeg([
          '-y',
          '-loop', '1', '-framerate', String(FPS), '-i', still,
          '-vf',
          `scale=${SLIDE_SIZE.width}:${SLIDE_SIZE.height},format=yuv420p,` +
            `fade=t=in:st=0:d=${fade},fade=t=out:st=${(frames / FPS - fade).toFixed(3)}:d=${fade}`,
          '-frames:v', String(frames),
          '-r', String(FPS),
          '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-crf', '20', '-pix_fmt', 'yuv420p',
          '-an',
          segment,
        ])
        segments.push(segment)

        /* Narration padded (or trimmed) to exactly the scene length. */
        const track = path.join(dir, `track-${i}.wav`)
        await runFfmpeg([
          '-y',
          ...(audio ? ['-i', audio] : ['-f', 'lavfi', '-i', `anullsrc=r=${AUDIO_RATE}:cl=stereo`]),
          '-af', `aresample=${AUDIO_RATE},aformat=channel_layouts=stereo,apad,atrim=0:${duration}`,
          '-ar', String(AUDIO_RATE), '-ac', '2', '-c:a', 'pcm_s16le',
          track,
        ])
        tracks.push(track)
      }

      const videoList = path.join(dir, 'segments.txt')
      await writeFile(videoList, concatList(segments))
      const audioList = path.join(dir, 'tracks.txt')
      await writeFile(audioList, concatList(tracks))
      const captions = input.captionsVtt ? path.join(dir, 'captions.vtt') : null
      if (captions && input.captionsVtt) await writeFile(captions, input.captionsVtt)

      const output = path.join(dir, 'lecture.mp4')
      await runFfmpeg([
        '-y',
        '-f', 'concat', '-safe', '0', '-i', videoList,
        '-f', 'concat', '-safe', '0', '-i', audioList,
        ...(captions ? ['-i', captions] : []),
        '-map', '0:v', '-map', '1:a',
        ...(captions ? ['-map', '2:0', '-c:s', 'mov_text', '-metadata:s:s:0', `language=${input.captionLanguage}`] : []),
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-ar', String(AUDIO_RATE),
        '-movflags', '+faststart',
        output,
      ])

      const mp4 = new Uint8Array(await readFile(output))
      const durationMs = Math.round((expectedFrames / FPS) * 1000)
      await verifyLectureVideo(mp4, durationMs, input.captionsVtt)
      return { mp4, durationMs }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
}
