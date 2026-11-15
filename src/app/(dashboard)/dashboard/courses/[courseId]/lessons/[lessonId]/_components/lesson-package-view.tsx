'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: LessonPackageView, lesson page, Lesson Studio,
 *   Script tab, Notes tab, Exercises tab, Quiz tab, QA tab
 *
 * WHAT:  One lesson's full package in tabs (blueprint §30): the video script
 *        as a storyboard, the readable notes, exercises with solutions, the
 *        quiz with answers, and the QA review.
 * WHY:   The author reviews everything a learner will get, in one place,
 *        before narration and rendering are produced. Read-only for now;
 *        editing and scoped regeneration land in a later step.
 * WHERE: /dashboard/courses/[courseId]/lessons/[lessonId].
 */

import Link from 'next/link'
import { DownloadIcon, MonitorPlayIcon } from 'lucide-react'

import { trpc } from '@/trpc/react-provider'
import { useActiveOrganizationId } from '@/hooks/use-active-organization'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { PageHeading } from '@/components/global/page-header'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LessonStatusBadge } from '../../../../_components/lesson-status-badge'
import { LessonNotes } from '@/components/global/course-content'
import { QuizAnswer } from '@/components/global/course-content'
import { SceneStoryboard } from './scene-storyboard'
import { formatDuration } from '@/components/global/course-content'

export function LessonPackageView({ courseId, lessonId }: { courseId: string; lessonId: string }) {
  const organizationId = useActiveOrganizationId()
  const query = trpc.lessons.get.useQuery(
    { organizationId: organizationId ?? '', courseId, lessonId },
    { enabled: organizationId !== undefined }
  )

  if (!organizationId || query.isLoading) return <Skeleton className="h-64 w-full" />
  if (query.error) return <p className="text-sm text-destructive">{query.error.message}</p>
  const data = query.data
  if (!data) return null

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PageHeading
          back={{ href: `/dashboard/courses/${courseId}`, label: data.course.title }}
          eyebrow={`Module ${data.lesson.module.position + 1}: ${data.lesson.module.title} · Lesson ${data.lesson.position + 1}`}
          title={data.lesson.title}
          meta={
            <>
              <LessonStatusBadge status={data.lesson.status} />
              {data.version ? <Badge variant="outline">Version {data.version.number}</Badge> : null}
              {data.lesson.objectiveRefs.map((ref) => (
                <Badge key={ref} variant="outline">
                  {ref}
                </Badge>
              ))}
            </>
          }
          actions={
            data.scenes.length > 0 ? (
              <Link
                href={`/dashboard/courses/${courseId}/learn?lesson=${lessonId}`}
                className={buttonVariants({ variant: 'outline' })}
              >
                <MonitorPlayIcon className="size-4" />
                Watch as learner
              </Link>
            ) : null
          }
        />
        {data.notes ? (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              {
                label: 'Video length',
                value:
                  data.scenes.length === 0
                    ? '—'
                    : `${data.videoLengthMeasured ? '' : '≈ '}${formatDuration(data.estimatedVideoMs)}`,
              },
              { label: 'Scenes', value: String(data.scenes.length) },
              { label: 'Exercises', value: String(data.exercises.length) },
              { label: 'Quiz questions', value: String(data.quiz.length) },
              {
                label: 'QA review',
                value: data.qa ? (data.qa.verdict === 'pass' ? 'Passed' : 'Needs revision') : 'Pending',
              },
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg border bg-card px-4 py-3">
                <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{stat.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      {data.version?.videoUrl ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="overflow-hidden rounded-xl border bg-background">
            <video
              src={data.version.videoUrl}
              poster={data.scenes[0]?.stillUrl ?? undefined}
              controls
              playsInline
              preload="metadata"
              crossOrigin="use-credentials"
              className="aspect-video w-full"
            >
              {data.version.captionsUrl ? (
                <track kind="captions" src={data.version.captionsUrl} srcLang="en" label="Captions" default />
              ) : null}
            </video>
          </div>
          <div className="space-y-3 rounded-xl border bg-card p-4 text-sm">
            <p className="font-semibold">Lecture video</p>
            <dl className="space-y-1 text-muted-foreground">
              <div className="flex justify-between">
                <dt>Length</dt>
                <dd className="tabular-nums">{formatDuration(data.version.videoDurationMs ?? 0)}</dd>
              </div>
              <div className="flex justify-between">
                <dt>Format</dt>
                <dd>MP4 · 1080p</dd>
              </div>
              <div className="flex justify-between">
                <dt>Size</dt>
                <dd className="tabular-nums">{((data.version.videoBytes ?? 0) / 1_048_576).toFixed(1)} MB</dd>
              </div>
              <div className="flex justify-between">
                <dt>Captions</dt>
                <dd>{data.version.captionsUrl ? 'Included' : 'None'}</dd>
              </div>
            </dl>
            <a href={`${data.version.videoUrl}?download=1`} className={buttonVariants({ variant: 'outline', className: 'w-full' })}>
              <DownloadIcon className="size-4" />
              Download MP4
            </a>
            {data.version.captionsUrl ? (
              <a href={`${data.version.captionsUrl}?download=1`} className={buttonVariants({ variant: 'ghost', className: 'w-full' })}>
                Download captions
              </a>
            ) : null}
          </div>
        </div>
      ) : null}

      {!data.notes ? (
        <Card>
          <CardHeader>
            <CardTitle>Not written yet</CardTitle>
            <CardDescription>This lesson is written when lesson generation runs for the course.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <Tabs defaultValue="script">
          {/* Still swipeable on narrow screens, but never shows a scrollbar. */}
          <TabsList className="w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] sm:w-fit [&::-webkit-scrollbar]:hidden">
            <TabsTrigger value="script">Video script</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="exercises">Exercises ({data.exercises.length})</TabsTrigger>
            <TabsTrigger value="quiz">Quiz ({data.quiz.length})</TabsTrigger>
            <TabsTrigger value="qa">QA review</TabsTrigger>
          </TabsList>

          <TabsContent value="script" className="pt-4">
            {data.scenes.length > 0 ? (
              <SceneStoryboard scenes={data.scenes} />
            ) : (
              <p className="text-sm text-muted-foreground">The video script has not been written yet.</p>
            )}
          </TabsContent>

          <TabsContent value="notes" className="pt-4">
            <Card className="mx-auto max-w-3xl">
              <CardHeader>
                <CardTitle>Lesson notes</CardTitle>
                <CardDescription>{data.notes.objectives.join(' · ')}</CardDescription>
              </CardHeader>
              <CardContent>
                <LessonNotes notes={data.notes} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="exercises" className="space-y-4 pt-4">
            {data.exercises.length === 0 ? <p className="text-sm text-muted-foreground">No exercises.</p> : null}
            {data.exercises.map((exercise) => (
              <Card key={exercise.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    {exercise.title}
                    <Badge variant="outline">{exercise.level.replace('_', ' ').toLowerCase()}</Badge>
                  </CardTitle>
                  <CardDescription>{exercise.content.estimatedMinutes} minutes</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="whitespace-pre-line">{exercise.content.instructions}</p>
                  {exercise.content.starterCode ? (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-muted-foreground">Starter</p>
                      <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{exercise.content.starterCode}</pre>
                    </div>
                  ) : null}
                  {exercise.content.hints.length > 0 ? (
                    <ul className="list-disc pl-5 text-muted-foreground">
                      {exercise.content.hints.map((h) => (
                        <li key={h}>Hint: {h}</li>
                      ))}
                    </ul>
                  ) : null}
                  <details className="rounded-md border p-3">
                    <summary className="cursor-pointer text-xs font-medium">Solution</summary>
                    <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs">{exercise.content.solution}</pre>
                  </details>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="quiz" className="space-y-3 pt-4">
            {data.quiz.length === 0 ? <p className="text-sm text-muted-foreground">No quiz.</p> : null}
            {data.quiz.map((item, i) => (
              <Card key={item.id}>
                <CardContent className="space-y-2 pt-6">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Q{i + 1}</Badge>
                    <Badge variant="outline">{item.content.type.replace('_', ' ').toLowerCase()}</Badge>
                    <Badge variant="outline">{item.objectiveRef}</Badge>
                    <Badge variant="outline">{item.difficulty.toLowerCase()}</Badge>
                  </div>
                  <QuizAnswer content={item.content} />
                  <p className="text-xs text-muted-foreground">{item.content.explanation}</p>
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="qa" className="pt-4">
            {data.qa ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    QA review
                    <Badge variant={data.qa.verdict === 'pass' ? 'default' : 'destructive'}>
                      {data.qa.verdict === 'pass' ? 'Passed' : 'Needs revision'}
                    </Badge>
                  </CardTitle>
                  <CardDescription>
                    {data.qa.issues.length === 0 ? 'No issues found.' : `${data.qa.issues.length} issue(s)`}
                    {data.version && data.qa.reviewedVersionId !== data.version.id ? ' · reviewed an earlier version' : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.qa.issues.map((issue, i) => (
                    <div key={i} className="space-y-1 rounded-md border p-3 text-sm">
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={issue.severity === 'high' ? 'destructive' : 'outline'}>{issue.severity}</Badge>
                        <Badge variant="outline">{issue.category.replace('_', ' ')}</Badge>
                        <span className="text-xs text-muted-foreground">{issue.location}</span>
                      </div>
                      <p>{issue.message}</p>
                      {issue.suggestedFix ? <p className="text-muted-foreground">Fix: {issue.suggestedFix}</p> : null}
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : (
              <p className="text-sm text-muted-foreground">Not reviewed yet.</p>
            )}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}
