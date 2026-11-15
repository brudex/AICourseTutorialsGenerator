'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: ListPagination, pager, page of, previous next,
 *   paginated list footer, totalPages
 *
 * WHAT:  The footer of a paginated list: "12 courses · page 2 of 3" with
 *        Previous and Next buttons.
 * WHY:   Every paginated list (courses, audit log) shows the same pager; the
 *        list owns its page state and passes it in, so this stays dumb and
 *        reusable. The noun is a prop so the count reads naturally.
 * WHERE: CoursesList, AuditLogsTable.
 */

import { Button } from '@/components/ui/button'

export interface ListPaginationProps {
  page: number
  totalPages: number
  total: number
  noun: { one: string; many: string }
  onPageChange: (page: number) => void
  /** Disables both buttons, e.g. while the next page is loading. */
  disabled?: boolean
}

export function ListPagination({ page, totalPages, total, noun, onPageChange, disabled = false }: ListPaginationProps) {
  const pages = Math.max(1, totalPages)
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-xs text-muted-foreground">
        {total} {total === 1 ? noun.one : noun.many} · page {Math.min(page, pages)} of {pages}
      </p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={disabled || page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={disabled || page >= pages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}
