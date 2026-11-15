/**
 * SOURCE OF TRUTH KEYWORDS: LessonStatusBadge, LESSON_STATUS_LABELS
 *
 * WHAT:  Badge for a lesson's production status.
 * WHERE: Curriculum editor rows and the lesson page header.
 */

import type { LessonStatus } from '@/generated/prisma'
import { Badge } from '@/components/ui/badge'

const LESSON_STATUS_LABELS: Record<LessonStatus, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  PLANNED: { label: 'Planned', variant: 'outline' },
  GENERATING: { label: 'Generating…', variant: 'secondary' },
  GENERATED: { label: 'Ready for review', variant: 'secondary' },
  QA_FLAGGED: { label: 'QA flagged', variant: 'destructive' },
  APPROVED: { label: 'Approved', variant: 'default' },
}

export function LessonStatusBadge({ status }: { status: LessonStatus }) {
  const { label, variant } = LESSON_STATUS_LABELS[status]
  return <Badge variant={variant}>{label}</Badge>
}
