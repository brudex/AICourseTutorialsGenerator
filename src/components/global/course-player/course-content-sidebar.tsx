'use client'

/**
 * SOURCE OF TRUTH KEYWORDS:⁠​‌‌​​‌‌​​‌​‌‌‌​​‌‌​‌​​​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​‌‌‌‌​​​‌​​‌​‌​​​‌​​‌‌‌⁠ CourseContentSidebar, course content list,
 *   lecture list, learner progress bar
 *
 * WHAT:  The "Course content" panel: overall progress, then every section
 *        with its lectures, durations, completion ticks, and the current
 *        lecture highlighted.
 * WHY:   Learner-friendly progression (docs/11 §1): learners always see
 *        where they are and what's next. Lectures not written yet are shown
 *        but disabled so the course structure is still visible.
 * WHERE: CoursePlayer.
 */

import { CheckCircle2Icon, CircleIcon, ListChecksIcon, PlayCircleIcon, TrophyIcon, type LucideIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { PlayerModule } from '@/lib/types'

interface CourseContentSidebarProps {
  modules: readonly PlayerModule[]
  currentLessonId: string | null
  completed: ReadonlySet<string>
  onSelect: (itemId: string) => void
  /* Practice items: `quiz:<moduleId>`, `final`, `project`. */
  sectionQuizzes: ReadonlyMap<string, number>
  finalQuestions: number
  hasProject: boolean
}

function PracticeRow({
  id,
  icon: Icon,
  label,
  meta,
  current,
  done,
  onSelect,
}: {
  id: string
  icon: LucideIcon
  label: string
  meta: string
  current: boolean
  done: boolean
  onSelect: (id: string) => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(id)}
        className={cn('flex w-full items-start gap-3 px-4 py-3 text-left text-sm transition-colors', current ? 'bg-muted' : 'hover:bg-muted/50')}
      >
        <span className="mt-0.5 shrink-0">{done ? <CheckCircle2Icon className="size-4" /> : <Icon className="size-4" />}</span>
        <span className="min-w-0 flex-1">
          <span className={cn('block', current && 'font-medium')}>{label}</span>
          <span className="block text-xs text-muted-foreground">{meta}</span>
        </span>
      </button>
    </li>
  )
}

export function CourseContentSidebar({
  modules,
  currentLessonId,
  completed,
  onSelect,
  sectionQuizzes,
  finalQuestions,
  hasProject,
}: CourseContentSidebarProps) {
  const lessons = modules.flatMap((m) => m.lessons)
  const doneCount = lessons.filter((l) => completed.has(l.id)).length
  const percent = lessons.length > 0 ? Math.round((doneCount / lessons.length) * 100) : 0

  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="space-y-2 border-b p-4">
        <p className="font-semibold">Course content</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-muted-foreground">
          {doneCount} of {lessons.length} lectures complete · {percent}%
        </p>
      </div>
      <div className="max-h-[70vh] overflow-y-auto">
        {modules.map((mod, moduleIndex) => {
          const minutes = mod.lessons.reduce((s, l) => s + l.estimatedMinutes, 0)
          const moduleDone = mod.lessons.filter((l) => completed.has(l.id)).length
          return (
            <section key={mod.id} className="border-b last:border-b-0">
              <div className="bg-muted/40 px-4 py-3">
                <p className="text-sm font-semibold">
                  Section {moduleIndex + 1}: {mod.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {moduleDone} / {mod.lessons.length} · {minutes} min
                </p>
              </div>
              <ol>
                {mod.lessons.map((lesson, lessonIndex) => {
                  const isCurrent = lesson.id === currentLessonId
                  const isDone = completed.has(lesson.id)
                  const available = lesson.currentVersionId !== null
                  return (
                    <li key={lesson.id}>
                      <button
                        type="button"
                        disabled={!available}
                        onClick={() => onSelect(lesson.id)}
                        className={cn(
                          'flex w-full items-start gap-3 px-4 py-3 text-left text-sm transition-colors',
                          isCurrent ? 'bg-muted' : 'hover:bg-muted/50',
                          !available && 'cursor-not-allowed opacity-50'
                        )}
                      >
                        <span className="mt-0.5 shrink-0">
                          {isDone ? (
                            <CheckCircle2Icon className="size-4" />
                          ) : isCurrent ? (
                            <PlayCircleIcon className="size-4" />
                          ) : (
                            <CircleIcon className="size-4 text-muted-foreground" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className={cn('block', isCurrent && 'font-medium')}>
                            {lessonIndex + 1}. {lesson.title}
                          </span>
                          <span className="block text-xs text-muted-foreground">
                            {available ? `${lesson.estimatedMinutes} min` : 'Not generated yet'}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
                {sectionQuizzes.has(mod.id) ? (
                  <PracticeRow
                    id={`quiz:${mod.id}`}
                    icon={ListChecksIcon}
                    label="Section quiz"
                    meta={`${sectionQuizzes.get(mod.id)} questions`}
                    current={currentLessonId === `quiz:${mod.id}`}
                    done={completed.has(`quiz:${mod.id}`)}
                    onSelect={onSelect}
                  />
                ) : null}
              </ol>
            </section>
          )
        })}
        {finalQuestions > 0 || hasProject ? (
          <section>
            <div className="bg-muted/40 px-4 py-3">
              <p className="text-sm font-semibold">Course wrap-up</p>
            </div>
            <ol>
              {finalQuestions > 0 ? (
                <PracticeRow
                  id="final"
                  icon={ListChecksIcon}
                  label="Final assessment"
                  meta={`${finalQuestions} questions`}
                  current={currentLessonId === 'final'}
                  done={completed.has('final')}
                  onSelect={onSelect}
                />
              ) : null}
              {hasProject ? (
                <PracticeRow
                  id="project"
                  icon={TrophyIcon}
                  label="Final project"
                  meta="Capstone"
                  current={currentLessonId === 'project'}
                  done={completed.has('project')}
                  onSelect={onSelect}
                />
              ) : null}
            </ol>
          </section>
        ) : null}
      </div>
    </div>
  )
}
