'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: MemberRowActions, COPYABLE_INVITE_LINK,
 *   handleCopyLink, handleResend, confirmCancel, remove member, invite actions
 *
 * WHAT:  The `⋯` menu of one team table row and its confirm dialogs: view,
 *        edit permissions and remove for members; copy link, resend and
 *        cancel for pending invitations.
 * WHY:   Actions are permission-gated (owners always pass) and the server
 *        re-checks each one. COPYABLE_INVITE_LINK: copying is the only invite
 *        action that is not a mutation; the link arrives on the row from
 *        member.list only when the server decided this caller may have it,
 *        so no client-side check has to stay in sync. Clicks stop here so
 *        the row's own click (open details) does not fire as well.
 * WHERE: Actions column of the team table (MemberManager).
 */

import * as React from 'react'
import { EyeIcon, LinkIcon, Loader2Icon, MoreHorizontalIcon, RefreshCwIcon, ShieldIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'

import { trpc } from '@/trpc/react-provider'
import { useActiveOrganization } from '@/hooks/use-active-organization'
import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'
import { permissions } from '@/lib/permissions'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { OrganizationMember } from './member-types'

interface MemberRowActionsProps {
  organizationId: string
  member: OrganizationMember
  onView: (member: OrganizationMember) => void
  onEdit: (member: OrganizationMember) => void
  onRemove: (memberId: string) => void
}

export function MemberRowActions({ organizationId, member, onView, onEdit, onRemove }: MemberRowActionsProps) {
  const { hasPermission } = useActiveOrganization()
  const utils = trpc.useUtils()
  const { copy } = useCopyToClipboard()
  const resend = trpc.invitation.resend.useMutation()
  const cancel = trpc.invitation.cancel.useMutation()
  const [confirm, setConfirm] = React.useState<'remove' | 'cancel' | null>(null)

  /* The owner and your own row are locked server-side; hide what would fail. */
  const locked = member.isOwner || member.isSelf
  const canUpdate = hasPermission(permissions.MEMBER_UPDATE) && !locked
  const canDelete = hasPermission(permissions.MEMBER_DELETE) && !locked
  const canCancel = hasPermission(permissions.INVITATION_CANCEL)
  const canResend = hasPermission(permissions.INVITATION_CREATE)
  const busy = resend.isPending || cancel.isPending

  /* Toast rather than an inline tick: the menu closes on select. */
  async function handleCopyLink(invitationLink: string) {
    const ok = await copy(invitationLink)
    if (ok) toast.success('Invitation link copied')
    else toast.error('Could not copy the link.', { description: invitationLink })
  }

  async function handleResend(invitationId: string) {
    try {
      await resend.mutateAsync({ organizationId, invitationId })
      toast.success('Invitation resent')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resend invitation')
    }
  }

  async function confirmCancel() {
    setConfirm(null)
    if (!member.invitationId) return
    try {
      await cancel.mutateAsync({ organizationId, invitationId: member.invitationId })
      await Promise.all([utils.member.list.invalidate({ organizationId }), utils.usage.invalidate()])
      toast.success('Invitation canceled')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel invitation')
    }
  }

  return (
    <div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-8" disabled={busy} />}>
          {busy ? <Loader2Icon className="size-4 animate-spin" /> : <MoreHorizontalIcon className="size-4" />}
          <span className="sr-only">Actions for {member.user.name}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={() => onView(member)}>
            <EyeIcon className="size-4" />
            View details
          </DropdownMenuItem>
          {member.isPending ? (
            <>
              {member.invitationLink ? (
                <DropdownMenuItem onClick={() => member.invitationLink && void handleCopyLink(member.invitationLink)}>
                  <LinkIcon className="size-4" />
                  Copy invite link
                </DropdownMenuItem>
              ) : null}
              {canResend && member.invitationId ? (
                <DropdownMenuItem onClick={() => member.invitationId && void handleResend(member.invitationId)}>
                  <RefreshCwIcon className="size-4" />
                  Resend invitation
                </DropdownMenuItem>
              ) : null}
              {canCancel ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirm('cancel')}>
                    <XIcon className="size-4" />
                    Cancel invitation
                  </DropdownMenuItem>
                </>
              ) : null}
            </>
          ) : (
            <>
              {canUpdate ? (
                <DropdownMenuItem onClick={() => onEdit(member)}>
                  <ShieldIcon className="size-4" />
                  Edit permissions
                </DropdownMenuItem>
              ) : null}
              {canDelete ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirm('remove')}>
                    <Trash2Icon className="size-4" />
                    Remove member
                  </DropdownMenuItem>
                </>
              ) : null}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'remove' ? 'Remove member?' : 'Cancel invitation?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === 'remove' ? (
                <>
                  <strong>{member.user.name}</strong> ({member.user.email}) loses access to everything in this organization.
                </>
              ) : (
                <>
                  <strong>{member.user.email}</strong> will no longer be able to accept this invitation.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{confirm === 'remove' ? 'Keep member' : 'Keep invitation'}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirm === 'remove') {
                  setConfirm(null)
                  onRemove(member.id)
                } else void confirmCancel()
              }}
            >
              {confirm === 'remove' ? 'Remove member' : 'Cancel invitation'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
