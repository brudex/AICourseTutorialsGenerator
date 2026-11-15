'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: CoursesList, courses index, New course button,
 *   course search, courses pagination
 *
 * WHAT:  The workspace's courses with status, size, and last update, a title
 *        search, pages of COURSES_PAGE_SIZE, and the "New course" entry point.
 *        Search follows the audit log pattern: a debounced controlled input,
 *        validated by listCoursesSchema on the server; a new search returns
 *        to page 1.
 * WHY:   "New course" sits inside <FeatureGate resource="courses"> so hitting
 *        the plan's course cap opens the upgrade modal instead of a dead end
 *        (the server enforces the same limit on courses.create).
 * WHERE: /dashboard/courses.
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { BookOpenIcon, PlusIcon, SearchIcon } from 'lucide-react'

import { trpc } from '@/trpc/react-provider'
import { useActiveOrganization, useActiveOrganizationId } from '@/hooks/use-active-organization'
import { permissions } from '@/lib/permissions'
import { COURSES_PAGE_SIZE } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { ListPagination } from '@/components/global/list-pagination'
import { Input } from '@/components/ui/input'
import { FeatureGate } from '@/components/feature-gate'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CourseStatusBadge } from './course-status-badge'

export function CoursesList() {
  const router = useRouter()
  const organizationId = useActiveOrganizationId()
  const { hasPermission } = useActiveOrganization()
  const [search, setSearch] = React.useState('')
  const [page, setPage] = React.useState(1)
  const appliedSearch = useDebouncedValue(search.trim())
  /* A new search invalidates the current page number. */
  const [lastSearch, setLastSearch] = React.useState(appliedSearch)
  if (appliedSearch !== lastSearch) {
    setLastSearch(appliedSearch)
    setPage(1)
  }
  const list = trpc.courses.list.useQuery(
    { organizationId: organizationId ?? '', page, pageSize: COURSES_PAGE_SIZE, ...(appliedSearch ? { search: appliedSearch } : {}) },
    { enabled: organizationId !== undefined, placeholderData: (previous) => previous }
  )
  const canCreate = hasPermission(permissions.COURSES_CREATE)

  const newCourseButton = canCreate ? (
    <FeatureGate resource="courses">
      <Button onClick={() => router.push('/dashboard/courses/new')}>
        <PlusIcon className="size-4" />
        New course
      </Button>
    </FeatureGate>
  ) : null

  if (!organizationId || list.isLoading) return <Skeleton className="h-40 w-full" />
  if (list.error) return <p className="text-sm text-destructive">{list.error.message}</p>

  const courses = list.data?.items ?? []

  if (courses.length === 0 && !appliedSearch && page === 1) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpenIcon className="size-5" /> Create your first course
          </CardTitle>
          <CardDescription>
            Describe what you want to teach. The Research Agent studies the topic and the Curriculum Architect drafts
            an outline for you to edit and approve.
          </CardDescription>
        </CardHeader>
        <CardContent>{newCourseButton}</CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search courses"
            aria-label="Search courses"
            maxLength={120}
            className="pl-8"
          />
        </div>
        {newCourseButton}
      </div>
      {courses.length === 0 ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">No courses match “{appliedSearch}”.</p>
      ) : null}
      <div className={cn('divide-y rounded-lg border transition-opacity', courses.length === 0 && 'hidden', list.isFetching && 'opacity-60')}>
        {courses.map((course) => (
          <Link
            key={course.id}
            href={`/dashboard/courses/${course.id}`}
            className="flex flex-col gap-2 p-4 transition-colors hover:bg-muted/50 md:flex-row md:items-center md:justify-between"
          >
            <div className="min-w-0 space-y-1">
              <p className="truncate text-sm font-medium">{course.title}</p>
              <p className="text-xs text-muted-foreground">
                {course._count.modules} modules · {course._count.lessons} lessons · updated{' '}
                {formatDistanceToNow(course.updatedAt, { addSuffix: true })}
              </p>
            </div>
            <CourseStatusBadge status={course.status} approved={course.curriculumApprovedAt !== null} />
          </Link>
        ))}
      </div>
      {list.data && list.data.total > 0 ? (
        <ListPagination
          page={list.data.page}
          totalPages={list.data.totalPages}
          total={list.data.total}
          noun={{ one: 'course', many: 'courses' }}
          onPageChange={setPage}
          disabled={list.isFetching}
        />
      ) : null}
    </div>
  )
}
