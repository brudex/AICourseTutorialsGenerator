/**
 * SOURCE OF TRUTH KEYWORDS: MemberRoleBadge, MemberStatusBadge, member role,
 *   member status, active, invited, invitation expired
 *
 * WHAT:  The role and status badges of a team member, shared by the team
 *        table and the member detail sheet.
 * WHY:   One definition of what "Active", "Invited" and "Expired" look like,
 *        using theme tokens only.
 * WHERE: MemberManager table, MemberDetailSheet.
 */

import { CrownIcon, MailIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import type { OrganizationMember } from './member-types'

type BadgeMember = Pick<OrganizationMember, 'isOwner' | 'isPending' | 'roleName' | 'expiresAt'>

export function MemberRoleBadge({ member }: { member: BadgeMember }) {
  if (member.isOwner) {
    return (
      <Badge variant="default">
        <CrownIcon className="size-3" />
        Owner
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="capitalize">
      {member.roleName}
    </Badge>
  )
}

export function MemberStatusBadge({ member }: { member: BadgeMember }) {
  if (!member.isPending) {
    return (
      <Badge variant="outline">
        <span className="size-1.5 rounded-full bg-success" />
        Active
      </Badge>
    )
  }
  if (member.expiresAt !== null && member.expiresAt < new Date()) {
    return <Badge variant="destructive">Invite expired</Badge>
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <MailIcon className="size-3" />
      Invited
    </Badge>
  )
}
