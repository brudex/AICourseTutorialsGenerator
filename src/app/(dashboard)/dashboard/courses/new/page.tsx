/**
 * SOURCE OF TRUTH KEYWORDS: NewCoursePage
 *
 * WHAT:  /dashboard/courses/new — the course brief form.
 * WHERE: "New course" button on /dashboard/courses (gated by courses:read via
 *        the parent nav route; creation itself needs courses:create).
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { NewCourseStart } from './_components/new-course-start'

export const metadata: Metadata = {
  title: 'New course',
}

export default function NewCoursePage() {
  return (
    <ContentLayout title="New course" description="Upload a course book or describe your topic.">
      <NewCourseStart />
    </ContentLayout>
  )
}
