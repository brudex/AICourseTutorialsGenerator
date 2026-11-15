'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: MaterialList, course downloads list, download
 *   button, CourseMaterialRow, resources list, workbook download
 *
 * WHAT:  A list of downloadable course materials: icon, title, one line
 *        description, file type and size, and a Download button.
 * WHY:   The same list serves authors (Materials tab, with an audience badge)
 *        and learners (Resources tab, learner files only), so it takes the
 *        rows plus options instead of fetching or filtering itself. Files are
 *        served through useAssetHref (studio: /api/assets, which checks
 *        membership; school: its enrollment checked route).
 * WHERE: Materials tab of CourseWorkspace; Resources tab of LectureTabs.
 */

import { DownloadIcon, FileArchiveIcon, FileTextIcon } from 'lucide-react'

import { cn, formatBytes } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import type { CourseMaterialRow } from '@/lib/types'
import { useAssetHref } from './asset-href'

interface MaterialListProps {
  materials: readonly CourseMaterialRow[]
  /* Authors see who each file is for; learners only ever get their own. */
  showAudience?: boolean
  emptyMessage: string
}

export function MaterialList({ materials, showAudience = false, emptyMessage }: MaterialListProps) {
  const assetHref = useAssetHref()
  if (materials.length === 0) return <p className="text-sm text-muted-foreground">{emptyMessage}</p>
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {materials.map((m) => {
        const Icon = m.fileName.endsWith('.zip') ? FileArchiveIcon : FileTextIcon
        return (
          <li key={m.id} className="flex flex-wrap items-center gap-4 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
              <Icon className="size-5 text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {m.title}
                {showAudience && m.audience === 'INSTRUCTOR' ? <Badge variant="outline">Instructor only</Badge> : null}
              </p>
              <p className="text-sm text-muted-foreground">{m.description}</p>
              <p className="text-xs text-muted-foreground">
                {m.fileName.split('.').pop()?.toUpperCase()} · {formatBytes(m.bytes)}
              </p>
            </div>
            <a
              href={`${assetHref(m.assetId)}?download=1`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              download={m.fileName}
            >
              <DownloadIcon className="size-4" />
              Download
            </a>
          </li>
        )
      })}
    </ul>
  )
}
