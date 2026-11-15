/**
 * SOURCE OF TRUTH KEYWORDS: CourseWorkspacePage
 *
 * WHAT:  /dashboard/courses/[courseId] — one course's workspace.
 * WHERE: Linked from the courses list and the new-course form.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { CourseWorkspace } from './_components/course-workspace'

export const metadata: Metadata = {
  title: 'Course',
}

export default async function CourseWorkspacePage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  return (
    <ContentLayout title="Course" heading={false}>
      <CourseWorkspace courseId={courseId} />
    </ContentLayout>
  )
}
