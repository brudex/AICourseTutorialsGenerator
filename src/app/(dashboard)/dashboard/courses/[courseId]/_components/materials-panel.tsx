'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: MaterialsPanel, course Downloads tab, course
 *   materials, workbook, answer key, cheat sheet, glossary, source code ZIP
 *
 * WHAT:  Author view of the course downloads, including the instructor only
 *        answer key.
 * WHY:   Fetched when the tab opens, so it always shows the files the latest
 *        build produced. Rebuilding is the "Build downloads" item in the
 *        Generate menu. After an export finishes, `autoDownload` starts the
 *        package download once the fresh list has loaded, so "Export" ends in
 *        a file on the user's machine.
 * WHERE: Downloads tab of CourseWorkspace.
 */

import * as React from 'react'
import { CheckCircle2Icon } from 'lucide-react'

import type { MaterialKind } from '@/generated/prisma'
import { trpc } from '@/trpc/react-provider'
import { Skeleton } from '@/components/ui/skeleton'
import { MaterialList } from '@/components/global/course-content'

export function MaterialsPanel({
  organizationId,
  courseId,
  autoDownload,
}: {
  organizationId: string
  courseId: string
  autoDownload: MaterialKind | null
}) {
  const materials = trpc.courses.materials.useQuery({ organizationId, courseId, audience: null })
  const target = autoDownload && !materials.isFetching ? materials.data?.find((m) => m.kind === autoDownload) : undefined
  /* Starts the download once per mount; a ref avoids a second render. */
  const started = React.useRef(false)
  React.useEffect(() => {
    if (!target || started.current) return
    started.current = true
    const link = document.createElement('a')
    link.href = `/api/assets/${target.assetId}?download=1`
    link.download = target.fileName
    link.click()
  }, [target])
  if (materials.isLoading) return <Skeleton className="h-48 w-full" />
  if (materials.error) return <p className="text-sm text-destructive">{materials.error.message}</p>
  return (
    <div className="space-y-3">
      {target ? (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2Icon className="size-4" /> {target.title} is ready. Your download has started.
        </p>
      ) : null}
      <p className="text-sm text-muted-foreground">Learners never see files marked Instructor only.</p>
      <MaterialList
        materials={materials.data ?? []}
        showAudience
        emptyMessage="No downloads yet. Use Generate, then Build downloads."
      />
    </div>
  )
}
