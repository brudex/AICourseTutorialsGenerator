'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: PublicationsCard, published to, publication
 *   status, publish progress, open on platform, publish again
 *
 * WHAT:  Where this course has been published: platform and account, status,
 *        upload progress, a link to the result, the reason when it failed,
 *        and Publish again (which resumes, skipping what already exists).
 * WHY:   Publishing runs in the worker; this card polls only while a
 *        publication is queued or running, then stops.
 * WHERE: CourseWorkspace (Overview tab), for members with publishing:read.
 */

import * as React from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ExternalLinkIcon, SendIcon } from 'lucide-react'

import type { PublicationStatus } from '@/generated/prisma'
import { trpc } from '@/trpc/react-provider'
import { PUBLISHING_PLATFORMS } from '@/lib/config/publishing'
import { PublishingPlatformIcon } from '@/components/global/publishing'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

const STATUS_LABEL: Record<PublicationStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Publishing',
  PUBLISHED: 'Published',
  FAILED: 'Failed',
}

export interface PublicationsCardProps {
  organizationId: string
  courseId: string
  canPublish: boolean
  onPublish: (connectionId?: string) => void
}

export function PublicationsCard({ organizationId, courseId, canPublish, onPublish }: PublicationsCardProps) {
  const publications = trpc.publishing.publications.useQuery(
    { organizationId, courseId },
    {
      refetchInterval: (query) =>
        (query.state.data ?? []).some((p) => p.status === 'QUEUED' || p.status === 'RUNNING') ? 4_000 : false,
    }
  )
  const rows = publications.data ?? []

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="space-y-1.5">
          <CardTitle>Published to</CardTitle>
          <CardDescription>Send this course to YouTube, Google Classroom or Canvas.</CardDescription>
        </div>
        {canPublish ? (
          <Button variant="outline" size="sm" onClick={() => onPublish()}>
            <SendIcon className="size-4" />
            Publish
          </Button>
        ) : null}
      </CardHeader>
      {rows.length > 0 ? (
        <CardContent>
          <ul className="divide-y rounded-lg border">
            {rows.map((publication) => {
              const percent = publication.itemsTotal > 0 ? Math.round((publication.itemsDone / publication.itemsTotal) * 100) : 0
              const live = publication.status === 'QUEUED' || publication.status === 'RUNNING'
              return (
                <li key={publication.id} className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <PublishingPlatformIcon platform={publication.platform} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {PUBLISHING_PLATFORMS[publication.platform].label} · {publication.connection.name}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {publication.publishedAt
                          ? `Published ${formatDistanceToNow(publication.publishedAt, { addSuffix: true })}`
                          : `Updated ${formatDistanceToNow(publication.updatedAt, { addSuffix: true })}`}
                      </p>
                    </div>
                    <Badge variant={publication.status === 'FAILED' ? 'destructive' : publication.status === 'PUBLISHED' ? 'secondary' : 'outline'}>
                      {STATUS_LABEL[publication.status]}
                    </Badge>
                    {publication.externalUrl ? (
                      <a
                        href={publication.externalUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-sm underline-offset-4 hover:underline"
                      >
                        Open
                        <ExternalLinkIcon className="size-3.5" />
                      </a>
                    ) : null}
                    {canPublish && !live ? (
                      <Button variant="ghost" size="sm" onClick={() => onPublish(publication.connection.id)}>
                        Publish again
                      </Button>
                    ) : null}
                  </div>
                  {live && publication.itemsTotal > 0 ? (
                    <div className="space-y-1">
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                        <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${percent}%` }} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {publication.itemsDone} of {publication.itemsTotal} steps
                      </p>
                    </div>
                  ) : null}
                  {publication.status === 'FAILED' && publication.error ? (
                    <p className="text-sm text-destructive">{publication.error}</p>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </CardContent>
      ) : null}
    </Card>
  )
}
