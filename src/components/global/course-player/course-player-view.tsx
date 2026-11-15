'use client'

/**
 * SOURCE OF TRUTH KEYWORDS:⁠​‌‌​​‌‌​​‌​‌‌‌​​‌‌​‌​​​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​‌‌‌‌​​​‌​​‌​‌​​​‌​​‌‌‌⁠ CoursePlayerView, course player, learner player,
 *   lecture video, practice view, course content sidebar, header slot
 *
 * WHAT:  The learner course player: the selected lecture's video (or the
 *        slideshow when no MP4 exists yet), title, complete and next
 *        controls, lecture tabs, practice items, and the course content
 *        sidebar with progress.
 * WHY:   One player for every learner surface. It owns no data fetching:
 *        callers pass the course, the selected lesson, practice, resources and
 *        progress from their own API, plus a `header` slot for their own back
 *        link and badge, so any future surface plugs in without a rewrite.
 * WHERE: dashboard/courses/[courseId]/learn (studio learner preview),
 *        school/[slug]/learn/[courseId] (students, with renderPractice).
 */

import * as React from 'react'
import { CheckCircle2Icon, CircleIcon } from 'lucide-react'

import type { CourseMaterialRow, PlayerCourse, PlayerLesson, PlayerPractice } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { CourseContentSidebar } from './course-content-sidebar'
import { LecturePlayer } from './lecture-player'
import { LectureVideo } from './lecture-video'
import { LectureTabs } from './lecture-tabs'
import { PracticeView } from './practice-view'
import type { usePlayerSelection } from './use-player-selection'

interface CoursePlayerViewProps {
  course: PlayerCourse
  selection: ReturnType<typeof usePlayerSelection>
  /* The selected lecture, once loaded (undefined while loading or for practice items). */
  lesson: PlayerLesson | undefined
  practice: PlayerPractice | null
  resources: readonly CourseMaterialRow[]
  completed: ReadonlySet<string>
  setCompleted: (itemKey: string, done: boolean) => void
  header: React.ReactNode
  /* Shown instead of the player when no lecture has been generated. */
  empty: React.ReactNode
  /* Overrides how a quiz or the project is shown (the school marks quizzes
   * on the server instead of revealing answers). Default: PracticeView. */
  renderPractice?: (practiceId: string) => React.ReactNode
  /* Sidebar counts when `practice` is not passed (no answers on the client). */
  practiceOutline?: { sections: ReadonlyMap<string, number>; finalQuestions: number; hasProject: boolean }
  /* Shown above the lecture, e.g. a course completed banner. */
  notice?: React.ReactNode
}

export function CoursePlayerView({
  course,
  selection,
  lesson,
  practice,
  resources,
  completed,
  setCompleted,
  header,
  empty,
  renderPractice,
  practiceOutline,
  notice,
}: CoursePlayerViewProps) {
  const { playable, practiceId, selectedId, selectedIndex, next, select, markCompleted, lessons } = selection
  if (playable.length === 0) return <>{empty}</>

  const loaded = lesson && lesson.lesson.id === selectedId ? lesson : undefined
  const current = lessons.find((l) => l.id === selectedId)
  const isDone = selectedId !== null && completed.has(selectedId)

  return (
    <div className="space-y-4">
      {header}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          {notice}
          {practiceId && renderPractice ? (
            renderPractice(practiceId)
          ) : practiceId ? (
            <PracticeView
              practiceId={practiceId}
              practice={practice}
              done={completed.has(practiceId)}
              onToggleDone={() => setCompleted(practiceId, !completed.has(practiceId))}
            />
          ) : (
            <>
              {loaded?.version?.videoUrl ? (
                <LectureVideo
                  key={loaded.version.id}
                  src={loaded.version.videoUrl}
                  captionsUrl={loaded.version.captionsUrl}
                  poster={loaded.scenes[0]?.stillUrl ?? null}
                  language={course.language}
                  nextLectureTitle={next?.title ?? null}
                  onEnded={() => markCompleted(true)}
                  onNextLecture={() => next && select(next.id)}
                />
              ) : loaded ? (
                <LecturePlayer
                  key={loaded.lesson.id}
                  scenes={loaded.scenes}
                  language={course.language}
                  nextLectureTitle={next?.title ?? null}
                  onEnded={() => markCompleted(true)}
                  onNextLecture={() => next && select(next.id)}
                />
              ) : (
                <Skeleton className="aspect-video w-full rounded-xl" />
              )}

              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  {loaded ? (
                    <p className="text-sm text-muted-foreground">
                      Section {loaded.lesson.module.position + 1} · Lecture {selectedIndex + 1} of {playable.length}
                    </p>
                  ) : null}
                  <h2 className="text-2xl font-semibold tracking-tight">{current?.title}</h2>
                </div>
                <div className="flex gap-2">
                  {selectedId ? (
                    <Button variant="outline" onClick={() => markCompleted(!isDone)}>
                      {isDone ? <CheckCircle2Icon className="size-4" /> : <CircleIcon className="size-4" />}
                      {isDone ? 'Completed' : 'Mark complete'}
                    </Button>
                  ) : null}
                  {next ? <Button onClick={() => select(next.id)}>Next lecture</Button> : null}
                </div>
              </div>

              {loaded ? <LectureTabs course={course} lesson={loaded} resources={resources} /> : null}
            </>
          )}
        </div>

        <aside className="xl:sticky xl:top-6 xl:self-start">
          <CourseContentSidebar
            modules={course.modules}
            currentLessonId={selectedId}
            completed={completed}
            onSelect={select}
            sectionQuizzes={practiceOutline?.sections ?? new Map((practice?.sections ?? []).map((sec) => [sec.moduleId, sec.items.length]))}
            finalQuestions={practiceOutline?.finalQuestions ?? practice?.finalAssessment.length ?? 0}
            hasProject={practiceOutline?.hasProject ?? practice?.project != null}
          />
        </aside>
      </div>
    </div>
  )
}
