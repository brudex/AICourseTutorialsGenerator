'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: SceneFrame, SCENE_LABELS, formatDuration,
 *   sceneStartTimes, scene layout preview, CodeBlock
 *
 * WHAT:  Draws one video scene's on-screen layout (16:9 content) from its
 *        typed spec, plus shared scene helpers (labels, timecodes).
 * WHY:   ONE renderer for scene layouts, shared by the author storyboard and
 *        the learner player, so what the author reviews is exactly what the
 *        learner sees. The final MP4 renderer (step 8) mirrors these layouts.
 *        Diagrams show the rendered SVG when available, else their source.
 * WHERE: Lesson page storyboard; learner player (/learn).
 */

import * as React from 'react'
import Image from 'next/image'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { Scene } from '@/lib/types'
import type { LessonSceneRow } from '@/lib/types'

export const SCENE_LABELS: Record<Scene['type'], string> = {
  TITLE_CARD: 'Title card',
  TALKING_POINTS: 'Talking points',
  DIAGRAM: 'Diagram',
  CODE_WALKTHROUGH: 'Code walkthrough',
  CODE_TYPING: 'Live coding',
  COMPARISON: 'Comparison',
  CALLOUT: 'Callout',
  SUMMARY: 'Summary',
  EXERCISE_PROMPT: 'Exercise',
  QUIZ_BREAK: 'Quiz break',
  ILLUSTRATION: 'Illustration',
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

/** Start offset (ms) of every scene, from measured or estimated durations. */
export function sceneStartTimes(scenes: readonly LessonSceneRow[]): number[] {
  return scenes.reduce<number[]>(
    (acc, _row, i) => [
      ...acc,
      i === 0 ? 0 : (acc[i - 1] ?? 0) + (scenes[i - 1]?.durationMs ?? scenes[i - 1]?.estimatedDurationMs ?? 0),
    ],
    []
  )
}

function CodeBlock({ code, highlight }: { code: string; highlight?: ReadonlyArray<readonly [number, number]> }) {
  const lines = code.split('\n')
  const isHighlighted = (n: number) => highlight?.some(([a, b]) => n >= a && n <= b) ?? false
  return (
    <pre className="max-h-full overflow-auto rounded-md border bg-background/80 p-3 font-mono text-xs leading-relaxed">
      {lines.map((line, i) => (
        <div key={i} className={cn('-mx-3 px-3', isHighlighted(i + 1) && 'bg-muted')}>
          <span className="mr-4 inline-block w-5 select-none text-right text-muted-foreground">{i + 1}</span>
          {line || ' '}
        </div>
      ))}
    </pre>
  )
}

function FrameHeading({ children }: { children: React.ReactNode }) {
  return <p className="text-lg font-semibold tracking-tight">{children}</p>
}

/* Rendered asset image (stills, diagrams). `unoptimized`: the asset route is
 * cookie-authenticated, which Next's image optimizer cannot forward. */
export function AssetImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return <Image src={src} alt={alt} fill unoptimized sizes="100vw" className={cn('object-contain', className)} />
}

export function SceneFrame({
  scene,
  diagramUrl = null,
  imageUrl = null,
}: {
  scene: Scene
  diagramUrl?: string | null
  /** The generated picture of an ILLUSTRATION scene. */
  imageUrl?: string | null
}) {
  switch (scene.type) {
    case 'ILLUSTRATION':
      return (
        <div className="flex h-full flex-col justify-center gap-3">
          <FrameHeading>{scene.onScreen.heading}</FrameHeading>
          {imageUrl ? (
            <div className="relative min-h-0 flex-1 overflow-hidden rounded-md">
              <AssetImage src={imageUrl} alt={scene.onScreen.caption ?? scene.onScreen.heading} className="object-cover" />
            </div>
          ) : (
            <p className="rounded-md border border-dashed bg-background/80 p-3 text-sm text-muted-foreground">{scene.onScreen.prompt}</p>
          )}
          <p className="text-xs text-muted-foreground">
            {scene.onScreen.caption ?? (imageUrl ? '' : 'Picture description. Drawn in the visuals step.')}
          </p>
        </div>
      )
    case 'TITLE_CARD':
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
          <p className="text-2xl font-semibold tracking-tight md:text-3xl">{scene.onScreen.title}</p>
          {scene.onScreen.subtitle ? <p className="text-muted-foreground">{scene.onScreen.subtitle}</p> : null}
        </div>
      )
    case 'TALKING_POINTS':
      return (
        <div className="flex h-full flex-col justify-center gap-4">
          <FrameHeading>{scene.onScreen.heading}</FrameHeading>
          <ul className="space-y-2.5">
            {scene.onScreen.bullets.map((b) => (
              <li key={b} className="flex gap-3 text-base">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-foreground" />
                {b}
              </li>
            ))}
          </ul>
        </div>
      )
    case 'DIAGRAM':
      return (
        <div className="flex h-full flex-col justify-center gap-3">
          <FrameHeading>{scene.onScreen.heading}</FrameHeading>
          {diagramUrl ? (
            <div className="relative min-h-0 flex-1">
              <AssetImage src={diagramUrl} alt={scene.onScreen.heading} />
            </div>
          ) : (
            <pre className="overflow-auto rounded-md border border-dashed bg-background/80 p-3 font-mono text-xs">
              {scene.onScreen.mermaid}
            </pre>
          )}
          <p className="text-xs text-muted-foreground">
            {scene.onScreen.caption ?? (diagramUrl ? '' : 'Diagram source. Rendered as an image in the visuals step.')}
          </p>
        </div>
      )
    case 'CODE_WALKTHROUGH':
      return (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <FrameHeading>{scene.onScreen.heading}</FrameHeading>
          <div className="min-h-0 flex-1">
            <CodeBlock code={scene.onScreen.code} highlight={scene.onScreen.steps.map((s) => [s.startLine, s.endLine] as const)} />
          </div>
        </div>
      )
    case 'CODE_TYPING':
      return (
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <FrameHeading>{scene.onScreen.heading}</FrameHeading>
            <Badge variant="outline" className="font-mono">
              {scene.onScreen.fileName}
            </Badge>
          </div>
          <div className="min-h-0 flex-1">
            <CodeBlock code={`${scene.onScreen.initialCode}${scene.onScreen.initialCode ? '\n' : ''}${scene.onScreen.typedCode}`} />
          </div>
          {scene.onScreen.result ? (
            <pre className="rounded-md border bg-background/80 p-2 font-mono text-xs text-muted-foreground">
              ▶ {scene.onScreen.result}
            </pre>
          ) : null}
        </div>
      )
    case 'COMPARISON':
      return (
        <div className="flex h-full flex-col justify-center gap-4">
          <FrameHeading>{scene.onScreen.heading}</FrameHeading>
          <div className="grid grid-cols-2 gap-4">
            {[
              { title: scene.onScreen.leftTitle, items: scene.onScreen.left, tone: 'border-destructive/40' },
              { title: scene.onScreen.rightTitle, items: scene.onScreen.right, tone: 'border-foreground/30' },
            ].map((col) => (
              <div key={col.title} className={cn('rounded-lg border-2 bg-background/60 p-4', col.tone)}>
                <p className="mb-2 text-sm font-semibold">{col.title}</p>
                <ul className="space-y-1.5 font-mono text-sm">
                  {col.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )
    case 'CALLOUT':
      return (
        <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
          <Badge
            variant={scene.onScreen.kind === 'mistake' || scene.onScreen.kind === 'warning' ? 'destructive' : 'secondary'}
            className="uppercase tracking-wide"
          >
            {scene.onScreen.kind.replace('_', ' ')}
          </Badge>
          <p className="text-xl font-semibold leading-snug">{scene.onScreen.message}</p>
        </div>
      )
    case 'SUMMARY':
      return (
        <div className="flex h-full flex-col justify-center gap-4">
          <FrameHeading>{scene.onScreen.heading}</FrameHeading>
          <ul className="space-y-2.5">
            {scene.onScreen.points.map((p) => (
              <li key={p} className="flex gap-3 text-base">
                <span className="text-muted-foreground">✓</span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      )
    case 'EXERCISE_PROMPT':
      return (
        <div className="flex h-full flex-col justify-center gap-3">
          <Badge variant="secondary" className="w-fit uppercase tracking-wide">
            Your turn
          </Badge>
          <FrameHeading>{scene.onScreen.heading}</FrameHeading>
          <p className="text-base">{scene.onScreen.task}</p>
          {scene.onScreen.hint ? <p className="text-sm text-muted-foreground">Hint: {scene.onScreen.hint}</p> : null}
        </div>
      )
    case 'QUIZ_BREAK':
      return (
        <div className="flex h-full flex-col justify-center gap-3">
          <Badge variant="secondary" className="w-fit uppercase tracking-wide">
            Quick check
          </Badge>
          <FrameHeading>{scene.onScreen.question}</FrameHeading>
          <ul className="grid gap-2 sm:grid-cols-2">
            {scene.onScreen.options.map((o, i) => (
              <li
                key={o}
                className={cn(
                  'rounded-md border bg-background/60 px-3 py-2 text-sm',
                  i === scene.onScreen.correctIndex && 'border-success-border bg-success/10 font-medium text-success'
                )}
              >
                {String.fromCharCode(65 + i)}. {o}
              </li>
            ))}
          </ul>
        </div>
      )
  }
}

