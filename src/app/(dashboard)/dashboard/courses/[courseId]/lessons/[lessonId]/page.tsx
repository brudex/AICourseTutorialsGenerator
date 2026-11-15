/**
 * SOURCE OF TRUTH KEYWORDS: LessonPage
 *
 * WHAT:  /dashboard/courses/[courseId]/lessons/[lessonId] — one lesson's
 *        package (video script, notes, exercises, quiz, QA).
 * WHERE: Linked from the curriculum editor once a lesson is written.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { LessonPackageView } from './_components/lesson-package-view'

export const metadata: Metadata = {
  title: 'Lesson',
}

export default async function LessonPage({ params }: { params: Promise<{ courseId: string; lessonId: string }> }) {
  const { courseId, lessonId } = await params
  return (
    <ContentLayout title="Lesson" heading={false}>
      <LessonPackageView courseId={courseId} lessonId={lessonId} />
    </ContentLayout>
  )
}
