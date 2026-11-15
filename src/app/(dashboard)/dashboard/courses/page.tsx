/**
 * SOURCE OF TRUTH KEYWORDS:⁠​‌‌​​‌‌​​‌​‌‌‌​​‌‌​‌​​​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​‌‌‌‌​​​‌​​‌​‌​​​‌​​‌‌‌⁠ CoursesPage
 *
 * WHAT:  /dashboard/courses — the workspace's courses.
 * WHERE: RESOURCES.courses.nav.href.
 */

import type { Metadata } from 'next'

import { ContentLayout } from '@/components/global/page-header'
import { CoursesList } from './_components/courses-list'

export const metadata: Metadata = {
  title: 'Courses',
}

export default function CoursesPage() {
  return (
    <ContentLayout title="Courses" description="Every course in this workspace.">
      <CoursesList />
    </ContentLayout>
  )
}
