'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: SceneStoryboard, SceneTimeline, storyboard,
 *   lecture video script view, NarrationText
 *
 * WHAT:  Storyboard view of a lesson's video script: a sticky scene timeline
 *        (jump links with timecodes) beside one card per scene — a 16:9 frame
 *        of what will be on screen and the narration that will be spoken,
 *        with emphasised words highlighted in place.
 * WHY:   Lets the author review the video before any audio or rendering is
 *        paid for (blueprint §30 Lesson Studio). The frame is a faithful
 *        layout preview drawn by the shared SceneFrame (same as the learner
 *        player). Timecodes are precomputed so render stays a pure map.
 * WHERE: Video script tab of the lesson page.
 */

import * as React from 'react'

import type { Scene } from '@/lib/types'
import type { LessonSceneRow } from '@/lib/types'
import { AssetImage, SCENE_LABELS, SceneFrame, formatDuration, sceneStartTimes } from '@/components/global/course-content'
import { Badge } from '@/components/ui/badge'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/* Narration with each emphasised word marked where it is spoken. */
function NarrationText({ text, emphasis }: { text: string; emphasis: readonly string[] }) {
  const words = emphasis.filter((w) => w.trim().length > 0)
  if (words.length === 0) return <>{text}</>
  const pattern = new RegExp(`(${words.map(escapeRegExp).join('|')})`, 'gi')
  const lower = new Set(words.map((w) => w.toLowerCase()))
  return (
    <>
      {text.split(pattern).map((part, i) =>
        lower.has(part.toLowerCase()) ? (
          <mark key={i} className="rounded bg-muted px-0.5 font-medium text-foreground">
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        )
      )}
    </>
  )
}

function sceneNotes(scene: Scene): string[] {
  if (scene.type === 'CODE_WALKTHROUGH') {
    return scene.onScreen.steps.map((s) => `Lines ${s.startLine}–${s.endLine}: ${s.note}`)
  }
  if (scene.type === 'QUIZ_BREAK') return [`Answer: ${scene.onScreen.explanation}`]
  return []
}

export function SceneStoryboard({ scenes }: { scenes: readonly LessonSceneRow[] }) {
  const starts = sceneStartTimes(scenes)

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
      {/* Scene timeline — sticky jump list with timecodes. */}
      <nav aria-label="Scenes" className="hidden lg:block">
        <ol className="sticky top-6 space-y-1 rounded-lg border p-2">
          {scenes.map((row, index) => (
            <li key={row.id}>
              <a
                href={`#scene-${row.position + 1}`}
                className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <span className="truncate">
                  <span className="mr-2 text-muted-foreground">{row.position + 1}</span>
                  {SCENE_LABELS[row.scene.type]}
                </span>
                <span className="shrink-0 font-mono text-xs text-muted-foreground">{formatDuration(starts[index] ?? 0)}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <ol className="space-y-6">
        {scenes.map((row, index) => {
          const start = starts[index] ?? 0
          const end = start + (row.durationMs ?? row.estimatedDurationMs)
          const notes = sceneNotes(row.scene)
          return (
            <li
              key={row.id}
              id={`scene-${row.position + 1}`}
              className="scroll-mt-6 overflow-hidden rounded-xl border bg-card"
            >
              <div className="grid xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
                {/* 16:9 frame — layout preview of what the renderer will draw. */}
                <div className="border-b bg-muted/30 p-4 xl:border-b-0 xl:border-r">
                  {row.stillUrl ? (
                    <div className="relative aspect-video overflow-hidden rounded-lg border bg-card shadow-sm">
                      <AssetImage src={row.stillUrl} alt={`Scene ${row.position + 1}: ${SCENE_LABELS[row.scene.type]}`} />
                    </div>
                  ) : (
                    <div className="relative aspect-video overflow-hidden rounded-lg border bg-card p-6 shadow-sm md:p-8">
                      <SceneFrame scene={row.scene} diagramUrl={row.diagramUrl} imageUrl={row.imageUrl} />
                      <span className="absolute bottom-2 right-3 font-mono text-[10px] text-muted-foreground">
                        {formatDuration(start)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-3 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {row.position + 1}
                    </span>
                    <span className="text-sm font-medium">{SCENE_LABELS[row.scene.type]}</span>
                    <Badge variant={row.stillUrl ? 'secondary' : 'outline'} className="text-[10px]">
                      {row.stillUrl ? 'Rendered' : 'Layout preview'}
                    </Badge>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      {formatDuration(start)} – {formatDuration(end)}
                      {row.durationMs === null ? ' est.' : ''}
                      {row.audioUrl ? ' · voiced' : ''}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Narration</p>
                    {row.audioUrl ? (
                      <audio controls preload="none" src={row.audioUrl} className="my-1 h-9 w-full">
                        <track kind="captions" />
                      </audio>
                    ) : null}
                    <p className="text-[15px] leading-7">
                      <NarrationText text={row.scene.narration} emphasis={row.scene.emphasis} />
                    </p>
                  </div>
                  {row.visualError ? <p className="text-xs text-destructive">{row.visualError}</p> : null}
                  {notes.length > 0 ? (
                    <ul className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
                      {notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
