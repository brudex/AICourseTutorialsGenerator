/**
 * SOURCE OF TRUTH KEYWORDS: LearnPage, learner preview page, course player
 *
 * WHAT:  /dashboard/courses/[courseId]/learn — watch the course as a learner
 *        (player, lecture tabs, course content sidebar). `?lesson=` selects a
 *        lecture.
 * WHY:   Suspense wraps the player because it reads search params on the
 *        client.
 * WHERE: "Preview as learner" buttons on the course and lesson pages.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { CoursePlayer } from './_components/course-player'

export const metadata: Metadata = {
  title: 'Learner preview',
}

export default async function LearnPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  return (
    <ContentLayout title="Learner preview" heading={false}>
      <Suspense fallback={<Skeleton className="h-[60vh] w-full" />}>
        <CoursePlayer courseId={courseId} />
      </Suspense>
    </ContentLayout>
  )
}
