'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: CoursePlayer, learner preview, studio course
 *   preview, /learn
 *
 * WHAT:  The studio's learner preview: loads the course, practice, learner
 *        downloads and the selected lesson through the studio API and renders
 *        the shared CoursePlayerView, with progress kept in this browser.
 * WHY:   Authors watch the course exactly as a learner will before
 *        exporting it; only the data source and the header differ.
 * WHERE: /dashboard/courses/[courseId]/learn.
 */

import Link from 'next/link'
import {  } from 'lucide-react'

import { trpc } from '@/trpc/react-provider'
import { useActiveOrganizationId } from '@/hooks/use-active-organization'
import { courseBriefSchema, type CourseDetail, type PlayerCourse } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { PageHeading } from '@/components/global/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { CoursePlayerView, useLocalProgress, usePlayerSelection } from '@/components/global/course-player'

/* The studio course mapped onto what the shared player needs. */
function toPlayerCourse(course: CourseDetail): PlayerCourse {
  return {
    id: course.id,
    title: course.title,
    description: course.description,
    whatYouWillLearn: course.whatYouWillLearn,
    language: courseBriefSchema.safeParse(course.brief).data?.language ?? 'English',
    modules: course.modules,
  }
}

export function CoursePlayer({ courseId }: { courseId: string }) {
  const organizationId = useActiveOrganizationId()
  const orgId = organizationId ?? ''
  const enabled = organizationId !== undefined
  const { completed, setCompleted } = useLocalProgress(courseId)

  const courseQuery = trpc.courses.get.useQuery({ organizationId: orgId, courseId }, { enabled })
  const practiceQuery = trpc.courses.practice.useQuery({ organizationId: orgId, courseId }, { enabled })
  const resourcesQuery = trpc.courses.materials.useQuery({ organizationId: orgId, courseId, audience: 'LEARNER' }, { enabled })
  const selection = usePlayerSelection({ modules: courseQuery.data?.modules ?? [], completed, setCompleted })
  const lessonQuery = trpc.lessons.get.useQuery(
    { organizationId: orgId, courseId, lessonId: selection.lectureId ?? '' },
    { enabled: enabled && selection.lectureId !== null }
  )

  if (!organizationId || courseQuery.isLoading) return <Skeleton className="h-[60vh] w-full" />
  if (courseQuery.error) return <p className="text-sm text-destructive">{courseQuery.error.message}</p>
  const course = courseQuery.data
  if (!course) return null

  return (
    <CoursePlayerView
      course={toPlayerCourse(course)}
      selection={selection}
      lesson={lessonQuery.data}
      practice={practiceQuery.data ?? null}
      resources={resourcesQuery.data ?? []}
      completed={completed}
      setCompleted={setCompleted}
      header={
        <PageHeading
          back={{ href: `/dashboard/courses/${courseId}`, label: 'Back to course editor' }}
          title={course.title}
          actions={<Badge variant="secondary">Learner preview</Badge>}
        />
      }
      empty={
        <div className="space-y-3 rounded-xl border p-8 text-center">
          <p className="font-semibold">No lectures to watch yet</p>
          <p className="text-sm text-muted-foreground">Generate the lessons for this course first.</p>
          <Link href={`/dashboard/courses/${courseId}`} className="text-sm underline underline-offset-4">
            Back to the course
          </Link>
        </div>
      }
    />
  )
}
