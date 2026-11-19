'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: LecturePlayer, scene slideshow, speechSynthesis,
 *   preview narration, captions, playback controls, SPEECH_LANG_CODES
 *
 * WHAT:  Plays one lecture as its video would run: each scene's frame is
 *        shown while its narration is spoken, then the next scene follows
 *        after the scene's pause. Controls: play/pause, previous/next scene,
 *        clickable scene timeline, speed, captions, mute, fullscreen.
 * WHY:   Lets authors (and later learners) watch a course before MP4s exist
 *        (step 8). Two engines: when every scene has narration audio (step 7)
 *        the real clips play through one <audio> element (pause resumes
 *        mid-sentence; speed and mute apply to the clip; the timeline follows
 *        the clip's position). Otherwise the browser's built-in voice (Web
 *        Speech API) reads the narration, and when that is unavailable or
 *        muted, scenes advance on their estimated durations.
 *        Narration is spoken sentence by sentence because some browsers cut
 *        off long utterances. Pause stops the voice; resume restarts the
 *        current scene from its beginning (browsers' speech pause/resume is
 *        unreliable). When MP4s exist, this component is swapped for a
 *        <video> element and the rest of the page stays the same.
 * WHERE: CoursePlayer (/dashboard/courses/[courseId]/learn).
 */

import * as React from 'react'
import {
  CaptionsIcon,
  CaptionsOffIcon,
  MaximizeIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SkipBackIcon,
  SkipForwardIcon,
  Volume2Icon,
  VolumeXIcon,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { AssetImage, SceneFrame, formatDuration, sceneStartTimes } from '@/components/global/course-content'
import type { LessonSceneRow } from '@/lib/types'
import { splitCues } from '@/lib/render/captions'

/* Brief languages are free text ("English"); the speech API wants BCP-47. */
const SPEECH_LANG_CODES: Record<string, string> = {
  english: 'en-US',
  french: 'fr-FR',
  spanish: 'es-ES',
  german: 'de-DE',
  portuguese: 'pt-BR',
  italian: 'it-IT',
  dutch: 'nl-NL',
  chinese: 'zh-CN',
  japanese: 'ja-JP',
  korean: 'ko-KR',
  arabic: 'ar-SA',
  hindi: 'hi-IN',
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2] as const

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/* The caption cue being spoken `elapsedMs` into a scene whose speech lasts
 * `speechMs`, timed by each cue's share of the characters (as buildWebVtt). */
function currentCue(narration: string, elapsedMs: number, speechMs: number): string {
  const cues = splitCues(narration)
  if (cues.length <= 1) return cues[0] ?? ''
  const totalChars = cues.reduce((sum, c) => sum + c.length, 0)
  const target = (Math.min(Math.max(elapsedMs, 0), Math.max(speechMs, 1)) / Math.max(speechMs, 1)) * totalChars
  let seen = 0
  for (const cue of cues) {
    seen += cue.length
    if (target < seen) return cue
  }
  return cues[cues.length - 1] ?? ''
}

interface LecturePlayerProps {
  scenes: readonly LessonSceneRow[]
  language: string
  nextLectureTitle: string | null
  onEnded: () => void
  onNextLecture: () => void
}

export function LecturePlayer({ scenes, language, nextLectureTitle, onEnded, onNextLecture }: LecturePlayerProps) {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const audioRef = React.useRef<HTMLAudioElement>(null)
  const audioMode = scenes.length > 0 && scenes.every((s) => s.audioUrl !== null)
  const [audioMs, setAudioMs] = React.useState(0)
  const [index, setIndex] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [started, setStarted] = React.useState(false)
  const [ended, setEnded] = React.useState(false)
  const [rate, setRate] = React.useState<(typeof SPEEDS)[number]>(1)
  const [muted, setMuted] = React.useState(false)
  const [captions, setCaptions] = React.useState(true)
  const [sceneStartedAt, setSceneStartedAt] = React.useState(0)
  const [now, setNow] = React.useState(0)

  const starts = sceneStartTimes(scenes)
  const durationOf = (row: LessonSceneRow | undefined) => (row ? (row.durationMs ?? row.estimatedDurationMs) : 0)
  const total = (starts[starts.length - 1] ?? 0) + durationOf(scenes[scenes.length - 1])
  const current = scenes[index]
  const lang = SPEECH_LANG_CODES[language.trim().toLowerCase()]

  function goTo(next: number) {
    setIndex(next)
    setSceneStartedAt(Date.now())
    setAudioMs(0)
  }

  /* Effect events read the latest props/handlers without re-running the
   * scene effect — a parent re-render must never restart the narration. */
  const advanceTo = React.useEffectEvent((next: number) => goTo(next))
  const finishLecture = React.useEffectEvent(() => {
    setPlaying(false)
    setEnded(true)
    onEnded()
  })

  /* Run the current scene: speak its narration (or wait its estimated
   * length), pause, then advance. Re-runs on scene, speed, or mute change;
   * cleanup cancels speech and timers so nothing overlaps. */
  React.useEffect(() => {
    if (!playing) return
    const row = scenes[index]
    if (!row) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const advance = () => {
      if (cancelled) return
      timer = setTimeout(() => {
        if (cancelled) return
        if (index < scenes.length - 1) advanceTo(index + 1)
        else finishLecture()
      }, row.scene.pauseAfterMs / rate)
    }
    const waitEstimated = () => {
      timer = setTimeout(advance, Math.max(1_500, row.estimatedDurationMs - row.scene.pauseAfterMs) / rate)
    }

    const audio = audioRef.current
    if (audioMode && audio && row.audioUrl) {
      /* Same scene → resume where it paused; new scene → load its clip. */
      if (audio.dataset['scene'] !== row.id) {
        audio.src = row.audioUrl
        audio.dataset['scene'] = row.id
      }
      audio.playbackRate = rate
      audio.muted = muted
      const onEnded = () => advance()
      const onTime = () => setAudioMs(audio.currentTime * 1000)
      audio.addEventListener('ended', onEnded)
      audio.addEventListener('timeupdate', onTime)
      void audio.play().catch(() => waitEstimated())
      return () => {
        cancelled = true
        if (timer) clearTimeout(timer)
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('timeupdate', onTime)
        audio.pause()
      }
    }

    const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null
    if (synth && !muted) {
      synth.cancel()
      const sentences = splitSentences(row.scene.narration)
      sentences.forEach((sentence, i) => {
        const utterance = new SpeechSynthesisUtterance(sentence)
        utterance.rate = rate
        if (lang) utterance.lang = lang
        if (i === sentences.length - 1) utterance.onend = advance
        utterance.onerror = () => {
          if (!cancelled && i === sentences.length - 1) waitEstimated()
        }
        synth.speak(utterance)
      })
    } else {
      waitEstimated()
    }

    const tick = setInterval(() => setNow(Date.now()), 200)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      clearInterval(tick)
      synth?.cancel()
    }
  }, [playing, index, rate, muted, scenes, lang, audioMode])

  function play() {
    if (ended) {
      setEnded(false)
      if (audioRef.current) audioRef.current.currentTime = 0
      goTo(0)
    } else {
      setSceneStartedAt(Date.now())
    }
    setStarted(true)
    setPlaying(true)
  }

  function step(delta: number) {
    const next = Math.min(Math.max(index + delta, 0), scenes.length - 1)
    setEnded(false)
    goTo(next)
  }

  function toggleFullscreen() {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen()
  }

  const sceneDuration = durationOf(current)
  const sceneElapsed = audioMode
    ? Math.min(audioMs, sceneDuration)
    : playing
      ? Math.min(Math.max(now - sceneStartedAt, 0) * rate, sceneDuration)
      : 0
  const elapsed = ended ? total : (starts[index] ?? 0) + sceneElapsed
  /* One short cue at a time (as the MP4's captions are timed), never the
   * whole scene narration: a paragraph on screen competes with the voice. */
  const caption = currentCue(current?.scene.narration ?? '', sceneElapsed, sceneDuration - (current?.scene.pauseAfterMs ?? 0))

  if (!current) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-xl border bg-card text-sm text-muted-foreground">
        This lecture has no video script yet.
      </div>
    )
  }

  return (
    <div ref={containerRef} className="overflow-hidden rounded-xl border bg-card">
      {/* Stage */}
      <div className="relative aspect-video bg-muted/30">
        {current.stillUrl ? (
          <AssetImage src={current.stillUrl} alt={`Scene ${index + 1}`} />
        ) : (
          <div className="absolute inset-0 p-6 md:p-10 lg:p-12">
            <SceneFrame scene={current.scene} diagramUrl={current.diagramUrl} imageUrl={current.imageUrl} />
          </div>
        )}

        {captions && started && !ended && caption ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-6 md:bottom-5">
            <p className="max-w-3xl rounded-md bg-black px-3 py-1.5 text-center text-sm leading-snug text-white md:text-base">
              {caption}
            </p>
          </div>
        ) : null}

        {!started ? (
          <button
            type="button"
            onClick={play}
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm transition-colors hover:bg-background/70"
            aria-label="Start lecture"
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg">
              <PlayIcon className="ml-1 size-7" />
            </span>
            <span className="text-sm font-medium">Start lecture · {formatDuration(total)}</span>
          </button>
        ) : null}

        {ended ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/85 text-center">
            <p className="text-lg font-semibold">Lecture complete</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={play}>
                <RotateCcwIcon className="size-4" />
                Replay
              </Button>
              {nextLectureTitle ? (
                <Button onClick={onNextLecture}>
                  Next: {nextLectureTitle}
                  <SkipForwardIcon className="size-4" />
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {/* Scene timeline — one segment per scene, proportional to its length. */}
      <div className="flex h-1.5 w-full gap-px bg-border">
        {scenes.map((row, i) => {
          const fill = ended || i < index ? 100 : i === index ? (sceneElapsed / Math.max(durationOf(row), 1)) * 100 : 0
          return (
            <button
              key={row.id}
              type="button"
              aria-label={`Go to scene ${i + 1}`}
              onClick={() => step(i - index)}
              className="relative h-full bg-muted"
              style={{ flexGrow: Math.max(durationOf(row), 1) }}
            >
              <span className="absolute inset-y-0 left-0 bg-primary" style={{ width: `${fill}%` }} />
            </button>
          )
        })}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-1 px-3 py-2">
        <Button variant="ghost" size="icon-sm" aria-label={playing ? 'Pause' : 'Play'} onClick={() => (playing ? setPlaying(false) : play())}>
          {playing ? <PauseIcon className="size-4" /> : <PlayIcon className="size-4" />}
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Previous scene" disabled={index === 0} onClick={() => step(-1)}>
          <SkipBackIcon className="size-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next scene" disabled={index === scenes.length - 1} onClick={() => step(1)}>
          <SkipForwardIcon className="size-4" />
        </Button>
        <span className="ml-1 font-mono text-xs tabular-nums text-muted-foreground">
          {formatDuration(elapsed)} / {formatDuration(total)}
        </span>
        <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">
          Scene {index + 1} of {scenes.length}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            aria-label="Playback speed"
            className="font-mono tabular-nums"
            onClick={() => setRate(SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length] ?? 1)}
          >
            {rate}x
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={captions ? 'Hide captions' : 'Show captions'} onClick={() => setCaptions((c) => !c)}>
            {captions ? <CaptionsIcon className="size-4" /> : <CaptionsOffIcon className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label={muted ? 'Unmute narration' : 'Mute narration'} onClick={() => setMuted((m) => !m)}>
            {muted ? <VolumeXIcon className="size-4" /> : <Volume2Icon className="size-4" />}
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Fullscreen" onClick={toggleFullscreen}>
            <MaximizeIcon className="size-4" />
          </Button>
        </div>
      </div>
      <audio ref={audioRef} preload="auto" className="hidden">
        <track kind="captions" />
      </audio>
      <p className={cn('border-t px-3 py-1.5 text-[11px] text-muted-foreground')}>
        {audioMode
          ? 'Narrated preview. The final MP4 is rendered in the next step.'
          : 'Preview with your browser’s voice. Generate narration for the studio voice.'}
      </p>
    </div>
  )
}
