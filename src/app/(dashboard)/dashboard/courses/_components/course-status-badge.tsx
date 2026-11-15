/**
 * SOURCE OF TRUTH KEYWORDS: CourseStatusBadge, COURSE_STATUS_LABELS,
 *   course status display
 *
 * WHAT:  Badge for a course's production status, with the approved state
 *        layered on top of CURRICULUM_REVIEW.
 * WHERE: Courses list and course workspace header.
 */

import type { CourseStatus } from '@/generated/prisma'
import { Badge } from '@/components/ui/badge'

const COURSE_STATUS_LABELS: Record<CourseStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  DRAFT: { label: 'Draft', variant: 'outline' },
  RESEARCHING: { label: 'Planning…', variant: 'secondary' },
  CURRICULUM_REVIEW: { label: 'Review curriculum', variant: 'default' },
  GENERATING: { label: 'Generating…', variant: 'secondary' },
  REVIEW: { label: 'In review', variant: 'default' },
  READY: { label: 'Ready', variant: 'default' },
  FAILED: { label: 'Needs attention', variant: 'destructive' },
}

export function CourseStatusBadge({ status, approved }: { status: CourseStatus; approved: boolean }) {
  if (approved && status === 'CURRICULUM_REVIEW') return <Badge variant="secondary">Curriculum approved</Badge>
  const { label, variant } = COURSE_STATUS_LABELS[status]
  return <Badge variant={variant}>{label}</Badge>
}
