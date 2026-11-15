/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: MemberManager, team table, TEAM_TABLE, member
 *   search, status tabs, role filter, member pagination
 *
 * WHAT:  The Team page body: one table of everyone in the organization (the
 *        owner first, then members, then pending invitations) with search,
 *        All / Active / Invited tabs with counts, a role filter, pages of
 *        TEAM_PAGE_SIZE, and a details panel per person. Hosts the
 *        edit-member and manage-roles sheets.
 * WHY:   Built on the global DataTable, so search, loading, the pager and
 *        responsive columns behave like every other list. Filtering and
 *        paging happen on the server (member.list); a new search or filter
 *        returns to page 1. The owner is a normal row with an Owner badge,
 *        so the list is never empty while the organization exists.
 * WHERE: Rendered by TeamClient (via the provider's member management slot).
 */

import * as React from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ShieldCheckIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'

import { trpc } from '@/trpc/react-provider'
import { useActiveOrganization } from '@/hooks/use-active-organization'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { permissions } from '@/lib/permissions'
import { TEAM_PAGE_SIZE, type MemberStatusFilter } from '@/lib/types'
import { DataTable, type DataTableColumn } from '@/components/global/data-table'
import { UserIdentity } from '@/components/global/user-identity'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { MemberSheetContent } from './member-sheet-content'
import { ManageRoleSheetContent } from './manage-role-sheet-content'
import { MemberDetailSheet } from './member-detail-sheet'
import { MemberRowActions } from './member-row-actions'
import { MemberRoleBadge, MemberStatusBadge } from './member-badges'
import type { OrganizationMember } from './member-types'

const ALL_ROLES = 'all'
const STATUS_TABS: ReadonlyArray<{ value: MemberStatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'invited', label: 'Invited' },
]

export function MemberManager({ organizationId }: { organizationId: string }) {
  const { hasPermission } = useActiveOrganization()
  const utils = trpc.useUtils()
  const canManageRoles = hasPermission(permissions.MEMBER_UPDATE)

  const [search, setSearch] = React.useState('')
  const [status, setStatus] = React.useState<MemberStatusFilter>('all')
  const [role, setRole] = React.useState(ALL_ROLES)
  const [page, setPage] = React.useState(1)
  const appliedSearch = useDebouncedValue(search.trim())

  /* Any change to what is filtered invalidates the current page number. */
  const filterKey = `${appliedSearch}|${status}|${role}`
  const [lastFilterKey, setLastFilterKey] = React.useState(filterKey)
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey)
    setPage(1)
  }

  const [viewing, setViewing] = React.useState<OrganizationMember | null>(null)
  const [editing, setEditing] = React.useState<OrganizationMember | null>(null)
  const [removing, setRemoving] = React.useState<OrganizationMember | null>(null)
  const [isRolesOpen, setIsRolesOpen] = React.useState(false)

  const list = trpc.member.list.useQuery(
    {
      organizationId,
      page,
      pageSize: TEAM_PAGE_SIZE,
      status,
      ...(appliedSearch ? { search: appliedSearch } : {}),
      ...(role !== ALL_ROLES ? { role } : {}),
    },
    { placeholderData: (previous) => previous }
  )
  const removeMember = trpc.member.delete.useMutation({
    onSuccess: async () => {
      /* Seat count feeds the gates and banners: refresh the whole usage router. */
      await Promise.all([utils.member.list.invalidate({ organizationId }), utils.usage.invalidate()])
      toast.success('Member removed')
    },
    onError: (e) => toast.error(e.message || 'Failed to remove member'),
  })

  function remove(memberId: string) {
    setViewing(null)
    removeMember.mutate({ organizationId, memberId })
  }

  const data = list.data
  const columns: ReadonlyArray<DataTableColumn<OrganizationMember>> = [
    {
      id: 'member',
      header: 'Member',
      cell: (member) => (
        <UserIdentity
          name={member.user.name}
          email={member.user.email}
          image={member.user.image}
          adornment={member.isSelf ? <Badge variant="outline" className="h-5 px-1.5 text-[10px]">You</Badge> : null}
        />
      ),
    },
    { id: 'role', header: 'Role', cell: (member) => <MemberRoleBadge member={member} />, hideBelow: 'sm' },
    { id: 'status', header: 'Status', cell: (member) => <MemberStatusBadge member={member} />, hideBelow: 'md' },
    {
      id: 'joined',
      header: 'Joined',
      hideBelow: 'lg',
      cell: (member) => (
        <span className="text-sm text-muted-foreground">
          {member.isPending ? 'Invited ' : ''}
          {formatDistanceToNow(member.joinedAt, { addSuffix: true })}
        </span>
      ),
    },
    {
      id: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      className: 'w-12',
      cell: (member) => (
        <MemberRowActions
          organizationId={organizationId}
          member={member}
          onView={setViewing}
          onEdit={setEditing}
          onRemove={remove}
        />
      ),
    },
  ]

  const filtered = appliedSearch !== '' || status !== 'all' || role !== ALL_ROLES

  return (
    <>
      <Sheet open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <MemberDetailSheet
          organizationId={organizationId}
          member={viewing}
          onEdit={(member) => {
            setViewing(null)
            setEditing(member)
          }}
          onRemove={setRemoving}
        />
      </Sheet>

      <Sheet open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <MemberSheetContent
          key={editing?.id ?? 'no-member'}
          organizationId={organizationId}
          editingMember={editing}
          onClose={() => setEditing(null)}
        />
      </Sheet>

      <Sheet open={isRolesOpen} onOpenChange={setIsRolesOpen}>
        <ManageRoleSheetContent organizationId={organizationId} onClose={() => setIsRolesOpen(false)} />
      </Sheet>

      <AlertDialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove member?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{removing?.user.name}</strong> ({removing?.user.email}) loses access to everything in this organization.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep member</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (removing) remove(removing.id)
                setRemoving(null)
              }}
            >
              Remove member
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="space-y-6">
        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(member) => member.id}
          onRowClick={setViewing}
          isLoading={list.isLoading}
          isFetching={list.isFetching}
          search={{ value: search, onChange: setSearch, placeholder: 'Search by name or email' }}
          filters={
            <>
              <Tabs value={status} onValueChange={(value: MemberStatusFilter) => setStatus(value)}>
                <TabsList>
                  {STATUS_TABS.map((tab) => (
                    <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                      {tab.label}
                      <span className="text-xs text-muted-foreground tabular-nums">{data?.counts[tab.value] ?? 0}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <Select value={role} onValueChange={(value) => setRole(value ?? ALL_ROLES)}>
                <SelectTrigger className="sm:w-40" aria-label="Filter by role">
                  <SelectValue>{(value: string) => (value === ALL_ROLES ? 'All roles' : value)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_ROLES}>All roles</SelectItem>
                  {(data?.roles ?? []).map((name) => (
                    <SelectItem key={name} value={name} className="capitalize">
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          }
          actions={
            canManageRoles ? (
              <Button variant="outline" onClick={() => setIsRolesOpen(true)}>
                <ShieldCheckIcon className="size-4" />
                Manage roles
              </Button>
            ) : null
          }
          empty={
            <div className="flex flex-col items-center gap-2">
              <UsersIcon className="size-6 text-muted-foreground" />
              <p className="text-sm font-medium">{filtered ? 'No one matches these filters' : 'No team members yet'}</p>
              <p className="text-xs text-muted-foreground">
                {filtered ? 'Try another search or clear the filters.' : 'Invite teammates with the button at the top of the page.'}
              </p>
            </div>
          }
          pagination={
            data
              ? {
                  page: data.page,
                  totalPages: data.totalPages,
                  total: data.total,
                  noun: { one: 'person', many: 'people' },
                  onPageChange: setPage,
                  disabled: list.isFetching,
                }
              : undefined
          }
        />
      </div>
    </>
  )
}
