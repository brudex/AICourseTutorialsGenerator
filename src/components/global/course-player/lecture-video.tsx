'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: LectureVideo, lecture MP4 playback, captions track
 *
 * WHAT:  Plays a lecture's rendered MP4 with its WebVTT captions, then offers
 *        the next lecture when it ends.
 * WHY:   Once step 8 has rendered a lecture, learners watch the real file —
 *        native controls give seeking, fullscreen, picture-in-picture, speed,
 *        and caption toggling for free and accessibly. The slideshow player
 *        remains the fallback for lectures not rendered yet.
 * WHERE: CoursePlayer.
 */

import * as React from 'react'
import { RotateCcwIcon, SkipForwardIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'

const CAPTION_LANG: Record<string, string> = { english: 'en', french: 'fr', spanish: 'es', german: 'de', portuguese: 'pt' }

interface LectureVideoProps {
  src: string
  captionsUrl: string | null
  poster: string | null
  language: string
  nextLectureTitle: string | null
  onEnded: () => void
  onNextLecture: () => void
}

export function LectureVideo({ src, captionsUrl, poster, language, nextLectureTitle, onEnded, onNextLecture }: LectureVideoProps) {
  const ref = React.useRef<HTMLVideoElement>(null)
  const [ended, setEnded] = React.useState(false)

  function replay() {
    setEnded(false)
    if (ref.current) {
      ref.current.currentTime = 0
      void ref.current.play()
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="relative aspect-video bg-background">
        <video
          ref={ref}
          src={src}
          poster={poster ?? undefined}
          controls
          playsInline
          preload="metadata"
          crossOrigin="use-credentials"
          className="size-full"
          onEnded={() => {
            setEnded(true)
            onEnded()
          }}
          onPlay={() => setEnded(false)}
        >
          {captionsUrl ? (
            <track kind="captions" src={captionsUrl} srcLang={CAPTION_LANG[language.toLowerCase()] ?? 'en'} label={language} default />
          ) : null}
        </video>
        {ended ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-background/85 text-center">
            <p className="text-lg font-semibold">Lecture complete</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button variant="outline" onClick={replay}>
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
    </div>
  )
}
