'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: PracticePanel, course Practice tab, section
 *   quizzes, final assessment, final project
 *
 * WHAT:  Author view of course-level practice: each section's quiz, the final
 *        assessment, and the final project brief (with reference solution).
 * WHERE: Practice tab of the course workspace.
 */

import { trpc } from '@/trpc/react-provider'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { QuizAnswer } from '@/components/global/course-content'
import { ProjectBriefView } from '@/components/global/course-content'

type Item = { id: string; objectiveRef: string; difficulty: string; content: Parameters<typeof QuizAnswer>[0]['content'] }

function ItemList({ items }: { items: readonly Item[] }) {
  return (
    <div className="space-y-3">
      {items.map((item, i) => (
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
    </div>
  )
}

export function PracticePanel({ organizationId, courseId }: { organizationId: string; courseId: string }) {
  const practice = trpc.courses.practice.useQuery({ organizationId, courseId })
  if (practice.isLoading) return <Skeleton className="h-48 w-full" />
  if (practice.error) return <p className="text-sm text-destructive">{practice.error.message}</p>
  const data = practice.data
  if (!data || (data.sections.length === 0 && data.finalAssessment.length === 0 && !data.project)) {
    return <p className="text-sm text-muted-foreground">Section quizzes, the final assessment and the project appear after lessons are generated.</p>
  }

  return (
    <div className="space-y-10">
      {data.sections.map((section) => (
        <section key={section.moduleId} className="space-y-3">
          <div>
            <p className="text-sm text-muted-foreground">Section quiz</p>
            <h3 className="text-lg font-semibold">{section.title}</h3>
          </div>
          <ItemList items={section.items} />
        </section>
      ))}
      {data.finalAssessment.length > 0 ? (
        <section className="space-y-3">
          <div>
            <p className="text-sm text-muted-foreground">{data.finalAssessment.length} questions</p>
            <h3 className="text-lg font-semibold">Final assessment</h3>
          </div>
          <ItemList items={data.finalAssessment} />
        </section>
      ) : null}
      {data.project ? (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Final project</h3>
          <ProjectBriefView project={data.project} showSolution />
        </section>
      ) : null}
    </div>
  )
}
