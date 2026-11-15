'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: PracticeView, learner section quiz, learner
 *   final assessment, learner final project
 *
 * WHAT:  The learner's view of a section quiz, the final assessment, or the
 *        final project (no reference solution), with Mark complete.
 * WHERE: CoursePlayer main area when a practice item is selected.
 */

import { CheckCircle2Icon, CircleIcon } from 'lucide-react'

import type { PlayerPractice } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { QuizQuestion } from '@/components/global/course-content'
import { ProjectBriefView } from '@/components/global/course-content'

export function PracticeView({
  practiceId,
  practice,
  done,
  onToggleDone,
}: {
  practiceId: string
  practice: PlayerPractice | null
  done: boolean
  onToggleDone: () => void
}) {
  if (!practice) return null
  const section = practiceId.startsWith('quiz:') ? practice.sections.find((s) => `quiz:${s.moduleId}` === practiceId) : null
  const items = section ? section.items : practiceId === 'final' ? practice.finalAssessment : []
  const title = section ? `Section quiz: ${section.title}` : practiceId === 'final' ? 'Final assessment' : 'Final project'

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            {practiceId === 'project' ? 'Capstone' : `${items.length} questions`}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        </div>
        <Button variant="outline" onClick={onToggleDone}>
          {done ? <CheckCircle2Icon className="size-4" /> : <CircleIcon className="size-4" />}
          {done ? 'Completed' : 'Mark complete'}
        </Button>
      </div>
      {practiceId === 'project' && practice.project ? (
        <ProjectBriefView project={practice.project} showSolution={false} />
      ) : (
        <div className="space-y-4">
          {items.map((item, i) => (
            <QuizQuestion key={item.id} number={i + 1} content={item.content} />
          ))}
        </div>
      )}
    </div>
  )
}
