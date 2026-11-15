'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: MemberDetailSheet, member details, member
 *   profile, permission summary, recent activity, invitation status
 *
 * WHAT:  The side panel that opens from a team table row: identity, role and
 *        status, joined or invited dates, what the member can do (grouped by
 *        feature), their recent activity, and the edit and remove actions.
 * WHY:   The table stays scannable while everything about one person lives
 *        in one place. Activity comes from the audit log and only loads for
 *        callers allowed to read it; the server enforces the same rule.
 *        Permissions are shown by feature ("Courses: read, update") instead
 *        of raw strings so a non-technical owner can read them.
 * WHERE: MemberManager (row click or "View details").
 */

import * as React from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { ShieldIcon, Trash2Icon } from 'lucide-react'

import { trpc } from '@/trpc/react-provider'
import { useActiveOrganization } from '@/hooks/use-active-organization'
import { permissions } from '@/lib/permissions'
import { getAuditEntityLabel } from '@/lib/types/audit'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { UserIdentity } from '@/components/global/user-identity'
import { MemberRoleBadge, MemberStatusBadge } from './member-badges'
import type { OrganizationMember } from './member-types'

const ACTIVITY_LIMIT = 5

/* "courses:read" + "courses:update" → [["Courses", ["read", "update"]]] */
function groupPermissions(list: readonly string[]): Array<[string, string[]]> {
  const groups = new Map<string, string[]>()
  for (const permission of list) {
    const [resource = permission, action = ''] = permission.split(':')
    groups.set(resource, [...(groups.get(resource) ?? []), action])
  }
  return [...groups.entries()].map(([resource, actions]) => [getAuditEntityLabel(resource), actions])
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

interface MemberDetailSheetProps {
  organizationId: string
  member: OrganizationMember | null
  onEdit: (member: OrganizationMember) => void
  onRemove: (member: OrganizationMember) => void
}

export function MemberDetailSheet({ organizationId, member, onEdit, onRemove }: MemberDetailSheetProps) {
  const { hasPermission } = useActiveOrganization()
  const canReadActivity = hasPermission(permissions.AUDIT_LOGS_READ)
  const userId = member?.userId ?? null
  const activity = trpc.auditLogs.list.useQuery(
    { organizationId, userId: userId ?? '', page: 1, pageSize: ACTIVITY_LIMIT },
    { enabled: canReadActivity && userId !== null && !member?.isPending }
  )

  if (!member) return <SheetContent />

  const locked = member.isOwner || member.isSelf
  const canEdit = !member.isPending && !locked && hasPermission(permissions.MEMBER_UPDATE)
  const canRemove = !member.isPending && !locked && hasPermission(permissions.MEMBER_DELETE)
  const grouped = groupPermissions(member.permissions)
  const expired = member.expiresAt !== null && member.expiresAt < new Date()

  return (
    <SheetContent className="gap-0">
      <SheetHeader className="border-b p-6">
        <SheetTitle className="sr-only">{member.user.name}</SheetTitle>
        <SheetDescription className="sr-only">Details for {member.user.email}</SheetDescription>
        <UserIdentity name={member.user.name} email={member.user.email} image={member.user.image} size="lg" />
        <div className="flex flex-wrap gap-2 pt-3">
          <MemberRoleBadge member={member} />
          <MemberStatusBadge member={member} />
          {member.isSelf ? <Badge variant="outline">You</Badge> : null}
        </div>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto p-6">
        <Section title="Details">
          <div className="divide-y rounded-lg border px-3">
            <DetailRow label={member.isPending ? 'Invited' : 'Joined'}>
              {format(member.joinedAt, 'd MMM yyyy')}
              <span className="block text-xs text-muted-foreground">
                {formatDistanceToNow(member.joinedAt, { addSuffix: true })}
              </span>
            </DetailRow>
            {member.expiresAt ? (
              <DetailRow label={expired ? 'Expired' : 'Expires'}>{format(member.expiresAt, 'd MMM yyyy')}</DetailRow>
            ) : null}
            <DetailRow label="Role">
              <span className="capitalize">{member.roleName}</span>
            </DetailRow>
          </div>
        </Section>

        <Section title="Access">
          {member.isOwner ? (
            <p className="text-sm text-muted-foreground">The owner has full access to everything in this organization.</p>
          ) : member.isPending ? (
            <p className="text-sm text-muted-foreground">Access starts when the invitation is accepted.</p>
          ) : grouped.length === 0 ? (
            <p className="text-sm text-muted-foreground">No permissions yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {grouped.map(([resource, actions]) => (
                <li key={resource} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                  <span>{resource}</span>
                  <span className="flex flex-wrap justify-end gap-1">
                    {actions.map((action) => (
                      <Badge key={action} variant="secondary" className="capitalize">
                        {action}
                      </Badge>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {canReadActivity && !member.isPending ? (
          <Section title="Recent activity">
            {activity.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (activity.data?.logs.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No recorded activity yet.</p>
            ) : (
              <ul className="space-y-3">
                {activity.data?.logs.map((log) => (
                  <li key={log.id} className="flex gap-3 text-sm">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate">
                        {log.description ?? `${log.action} ${getAuditEntityLabel(log.entity).toLowerCase()}`}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(log.createdAt, { addSuffix: true })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}
      </div>

      {canEdit || canRemove ? (
        <>
          <Separator />
          <SheetFooter className="flex-row justify-end gap-2 p-6">
            {canRemove ? (
              <Button variant="outline" className="text-destructive" onClick={() => onRemove(member)}>
                <Trash2Icon className="size-4" />
                Remove
              </Button>
            ) : null}
            {canEdit ? (
              <Button onClick={() => onEdit(member)}>
                <ShieldIcon className="size-4" />
                Edit permissions
              </Button>
            ) : null}
          </SheetFooter>
        </>
      ) : null}
    </SheetContent>
  )
}
