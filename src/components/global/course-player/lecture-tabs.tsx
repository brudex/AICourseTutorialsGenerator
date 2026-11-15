'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: LectureTabs, learner quiz, QuizQuestion,
 *   interactive quiz, learner exercises, lecture overview
 *
 * WHAT:  The tabs under the player: Overview (lecture objectives + what the
 *        course teaches), Notes, Exercises (solutions hidden until asked),
 *        an interactive Quiz that checks answers and explains them, and the
 *        course Resources (learner downloads).
 * WHY:   A learner's view, not an author's: answers stay hidden until the
 *        learner commits. Choice questions are graded on click; open
 *        questions (short answer, fill-in, matching) reveal a model answer.
 *        Right answers use the theme's `success` token, wrong ones
 *        `destructive` — never hard-coded colours.
 * WHERE: CoursePlayerView (studio learner preview).
 */

import * as React from 'react'
import { CheckCircle2Icon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { LessonNotes } from '@/components/global/course-content'
import { QuizQuestion } from '@/components/global/course-content'
import { MaterialList } from '@/components/global/course-content'
import type { CourseMaterialRow, PlayerCourse, PlayerLesson } from '@/lib/types'

export function LectureTabs({
  course,
  lesson,
  resources,
}: {
  course: Pick<PlayerCourse, 'whatYouWillLearn' | 'description'>
  lesson: PlayerLesson
  /* Learner audience only; the player never requests instructor files. */
  resources: readonly CourseMaterialRow[]
}) {
  return (
    <Tabs defaultValue="overview">
      <TabsList className="w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] sm:w-fit [&::-webkit-scrollbar]:hidden">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="notes">Notes</TabsTrigger>
        <TabsTrigger value="exercises">Exercises ({lesson.exercises.length})</TabsTrigger>
        <TabsTrigger value="quiz">Quiz ({lesson.quiz.length})</TabsTrigger>
        <TabsTrigger value="resources">Resources ({resources.length})</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="space-y-6 pt-4">
        {lesson.notes ? (
          <div className="space-y-2">
            <p className="font-semibold">In this lecture you will</p>
            <ul className="space-y-1.5 text-sm">
              {lesson.notes.objectives.map((o) => (
                <li key={o} className="flex gap-2">
                  <CheckCircle2Icon className="mt-0.5 size-4 shrink-0" /> {o}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {course.whatYouWillLearn.length > 0 ? (
          <div className="space-y-2 rounded-xl border p-4">
            <p className="font-semibold">What you’ll learn in this course</p>
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
              {course.whatYouWillLearn.map((item) => (
                <li key={item} className="flex gap-2">
                  <span className="text-muted-foreground">✓</span> {item}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {course.description ? (
          <div className="space-y-2">
            <p className="font-semibold">About this course</p>
            <p className="whitespace-pre-line text-sm text-muted-foreground">{course.description}</p>
          </div>
        ) : null}
      </TabsContent>

      <TabsContent value="notes" className="pt-4">
        {lesson.notes ? (
          <div className="max-w-3xl">
            <LessonNotes notes={lesson.notes} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No notes for this lecture.</p>
        )}
      </TabsContent>

      <TabsContent value="exercises" className="space-y-4 pt-4">
        {lesson.exercises.length === 0 ? <p className="text-sm text-muted-foreground">No exercises for this lecture.</p> : null}
        {lesson.exercises.map((exercise) => (
          <Card key={exercise.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {exercise.title}
                <Badge variant="outline">{exercise.level.replace('_', ' ').toLowerCase()}</Badge>
                <span className="text-xs font-normal text-muted-foreground">{exercise.content.estimatedMinutes} min</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="whitespace-pre-line">{exercise.content.instructions}</p>
              {exercise.content.starterCode ? (
                <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs">{exercise.content.starterCode}</pre>
              ) : null}
              {exercise.content.expectedOutput ? (
                <p className="text-muted-foreground">Expected result: {exercise.content.expectedOutput}</p>
              ) : null}
              {exercise.content.hints.map((hint, i) => (
                <details key={hint} className="rounded-md border px-3 py-2">
                  <summary className="cursor-pointer text-xs font-medium">Hint {i + 1}</summary>
                  <p className="mt-1 text-muted-foreground">{hint}</p>
                </details>
              ))}
              <details className="rounded-md border px-3 py-2">
                <summary className="cursor-pointer text-xs font-medium">Show solution</summary>
                <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs">{exercise.content.solution}</pre>
              </details>
            </CardContent>
          </Card>
        ))}
      </TabsContent>

      <TabsContent value="quiz" className="space-y-4 pt-4">
        {lesson.quiz.length === 0 ? <p className="text-sm text-muted-foreground">No quiz for this lecture.</p> : null}
        {lesson.quiz.map((item, i) => (
          <QuizQuestion key={item.id} number={i + 1} content={item.content} />
        ))}
      </TabsContent>

      <TabsContent value="resources" className="pt-4">
        <MaterialList materials={resources} emptyMessage="No downloads for this course yet." />
      </TabsContent>
    </Tabs>
  )
}
