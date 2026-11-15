'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: CurriculumEditor, curriculum view, module list,
 *   lesson list, reorder lessons, learning outcomes display
 *
 * WHAT:  Shows the planned curriculum — goal, outcomes, prerequisites,
 *        modules and lessons with durations and outcome links — and, while it
 *        is editable, lets the user rename, add, delete, and reorder. Once a
 *        lesson is written, its title links to the lesson page.
 * WHY:   Blueprint §9/§29: the user must be able to shape the plan before any
 *        expensive lesson generation. `editable` is decided by the workspace
 *        (not approved, no live job, has courses:update); the server enforces
 *        the same rule on every curriculum mutation.
 * WHERE: Course workspace.
 */

import * as React from 'react'
import Link from 'next/link'
import { ArrowDownIcon, ArrowUpIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'

import { trpc } from '@/trpc/react-provider'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatPageRange } from '@/lib/utils'
import type { CourseDetail, CourseLessonRow, CourseModuleRow } from '@/lib/types'
import { LessonStatusBadge } from '../../_components/lesson-status-badge'
import { LessonFormDialog, ModuleFormDialog } from './curriculum-item-dialogs'

type DialogState =
  | { type: 'editModule'; module: CourseModuleRow }
  | { type: 'addModule' }
  | { type: 'editLesson'; lesson: CourseLessonRow }
  | { type: 'addLesson'; moduleId: string }
  | null

function minutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

export function CurriculumEditor({
  organizationId,
  course,
  editable,
}: {
  organizationId: string
  course: CourseDetail
  editable: boolean
}) {
  const utils = trpc.useUtils()
  const updateModule = trpc.curriculum.updateModule.useMutation()
  const createModule = trpc.curriculum.createModule.useMutation()
  const updateLesson = trpc.curriculum.updateLesson.useMutation()
  const createLesson = trpc.curriculum.createLesson.useMutation()
  const move = trpc.curriculum.move.useMutation()
  const remove = trpc.curriculum.remove.useMutation()
  const [dialog, setDialog] = React.useState<DialogState>(null)
  const [error, setError] = React.useState<string | null>(null)

  const base = { organizationId, courseId: course.id }
  const refresh = () => utils.courses.get.invalidate(base)

  async function run(action: () => Promise<unknown>) {
    setError(null)
    try {
      await action()
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the curriculum.')
    }
  }

  const totalMinutes = course.modules.reduce((sum, m) => sum + m.estimatedMinutes, 0)
  const lessonCount = course.modules.reduce((sum, m) => sum + m.lessons.length, 0)
  const busy = move.isPending || remove.isPending

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Course outline</CardTitle>
          <CardDescription>
            {course.modules.length} modules · {lessonCount} lessons · {minutesLabel(totalMinutes)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {course.goal ? <p>{course.goal}</p> : null}
          {course.outcomes.length > 0 ? (
            <div className="space-y-2">
              <p className="font-medium">Learning outcomes</p>
              <ul className="space-y-1">
                {course.outcomes.map((o) => (
                  <li key={o.id} className="flex gap-2">
                    <Badge variant="outline" className="shrink-0">
                      {o.id}
                    </Badge>
                    <span className="text-muted-foreground">{o.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {course.prerequisites.length > 0 ? (
            <div className="space-y-1">
              <p className="font-medium">Prerequisites</p>
              <p className="text-muted-foreground">{course.prerequisites.join(' · ')}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {course.modules.map((mod, moduleIndex) => (
        <Card key={mod.id}>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <CardTitle className="text-base">
                  Module {moduleIndex + 1}: {mod.title}
                </CardTitle>
                <CardDescription>
                  {minutesLabel(mod.estimatedMinutes)}
                  {mod.bookChapter ? ` · Book pages ${formatPageRange(mod.bookChapter.startPage, mod.bookChapter.endPage)}` : ''}
                  {mod.summary ? ` · ${mod.summary}` : ''}
                </CardDescription>
              </div>
              {editable ? (
                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Move module up"
                    disabled={busy || moduleIndex === 0}
                    onClick={() => void run(() => move.mutateAsync({ ...base, itemType: 'module', itemId: mod.id, direction: 'up' }))}
                  >
                    <ArrowUpIcon className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Move module down"
                    disabled={busy || moduleIndex === course.modules.length - 1}
                    onClick={() => void run(() => move.mutateAsync({ ...base, itemType: 'module', itemId: mod.id, direction: 'down' }))}
                  >
                    <ArrowDownIcon className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Edit module" onClick={() => setDialog({ type: 'editModule', module: mod })}>
                    <PencilIcon className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Delete module"
                    disabled={busy}
                    onClick={() => void run(() => remove.mutateAsync({ ...base, itemType: 'module', itemId: mod.id }))}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <ol className="divide-y rounded-lg border">
              {mod.lessons.map((lesson, lessonIndex) => (
                <li key={lesson.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm">
                      <span className="text-muted-foreground">{lessonIndex + 1}.</span>{' '}
                      {lesson.currentVersionId ? (
                        <Link
                          href={`/dashboard/courses/${course.id}/lessons/${lesson.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {lesson.title}
                        </Link>
                      ) : (
                        lesson.title
                      )}
                    </p>
                    <div className="flex flex-wrap items-center gap-1">
                      {lesson.status !== 'PLANNED' ? <LessonStatusBadge status={lesson.status} /> : null}
                      <span className="text-xs text-muted-foreground">{minutesLabel(lesson.estimatedMinutes)}</span>
                      {lesson.bookStartPage !== null && lesson.bookEndPage !== null ? (
                        <span className="text-xs text-muted-foreground">
                          · pp. {formatPageRange(lesson.bookStartPage, lesson.bookEndPage)}
                        </span>
                      ) : null}
                      {lesson.objectiveRefs.map((ref) => (
                        <Badge key={ref} variant="outline" className="text-[10px]">
                          {ref}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  {editable ? (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Move lesson up"
                        disabled={busy || lessonIndex === 0}
                        onClick={() => void run(() => move.mutateAsync({ ...base, itemType: 'lesson', itemId: lesson.id, direction: 'up' }))}
                      >
                        <ArrowUpIcon className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Move lesson down"
                        disabled={busy || lessonIndex === mod.lessons.length - 1}
                        onClick={() => void run(() => move.mutateAsync({ ...base, itemType: 'lesson', itemId: lesson.id, direction: 'down' }))}
                      >
                        <ArrowDownIcon className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Edit lesson" onClick={() => setDialog({ type: 'editLesson', lesson })}>
                        <PencilIcon className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Delete lesson"
                        disabled={busy}
                        onClick={() => void run(() => remove.mutateAsync({ ...base, itemType: 'lesson', itemId: lesson.id }))}
                      >
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ol>
            {editable ? (
              <Button variant="outline" size="sm" onClick={() => setDialog({ type: 'addLesson', moduleId: mod.id })}>
                <PlusIcon className="size-4" />
                Add lesson
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ))}

      {editable ? (
        <Button variant="outline" onClick={() => setDialog({ type: 'addModule' })}>
          <PlusIcon className="size-4" />
          Add module
        </Button>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <ModuleFormDialog
        open={dialog?.type === 'editModule' || dialog?.type === 'addModule'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog?.type === 'editModule' ? 'Edit module' : 'Add module'}
        initial={
          dialog?.type === 'editModule'
            ? { title: dialog.module.title, summary: dialog.module.summary }
            : { title: '', summary: '' }
        }
        onSave={async (values) => {
          if (dialog?.type === 'editModule') {
            await updateModule.mutateAsync({ ...base, moduleId: dialog.module.id, ...values })
          } else {
            await createModule.mutateAsync({ ...base, title: values.title })
          }
          await refresh()
        }}
      />
      <LessonFormDialog
        open={dialog?.type === 'editLesson' || dialog?.type === 'addLesson'}
        onOpenChange={(open) => !open && setDialog(null)}
        title={dialog?.type === 'editLesson' ? 'Edit lesson' : 'Add lesson'}
        initial={
          dialog?.type === 'editLesson'
            ? { title: dialog.lesson.title, estimatedMinutes: dialog.lesson.estimatedMinutes }
            : { title: '', estimatedMinutes: 10 }
        }
        onSave={async (values) => {
          if (dialog?.type === 'editLesson') {
            await updateLesson.mutateAsync({ ...base, lessonId: dialog.lesson.id, ...values })
          } else if (dialog?.type === 'addLesson') {
            await createLesson.mutateAsync({ ...base, moduleId: dialog.moduleId, ...values })
          }
          await refresh()
        }}
      />
    </div>
  )
}
