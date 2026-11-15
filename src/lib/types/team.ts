/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: inviteMemberSchema, updateMemberSchema,
 *   removeMemberSchema, cancelInvitationSchema, resendInvitationSchema,
 *   createRoleSchema, updateRoleSchema, deleteRoleSchema, roleNameSchema,
 *   permissionStringSchema, RESERVED_ROLE_NAMES, VALID_PERMISSION_STRINGS
 *
 * WHAT:  Zod schemas + inferred types for every member / invitation / custom-
 *        role input across the team-management routers and UI.
 * WHY:   One contract per input surface (CLAUDE.md). Permissions validate
 *        against the live RESOURCES-derived set so a role can never persist a
 *        permission the app doesn't define; `owner` is reserved so a custom
 *        role can't shadow the static owner role.
 * WHERE: Imported by src/trpc/routers/{member,invitation,organization-roles}.ts
 *        and the team UI. Re-exported via src/lib/types.
 */

import { z } from 'zod'
import { RESOURCE_ENTRIES } from '@/lib/resources'

/* Built once from the registry — the set of every legal `resource:action`. */
const VALID_PERMISSION_SET = new Set<string>()
for (const [key, def] of RESOURCE_ENTRIES) {
  if (!def.permissions) continue
  for (const action of def.permissions) VALID_PERMISSION_SET.add(`${key}:${action}`)
}

export const VALID_PERMISSION_STRINGS: readonly string[] = [...VALID_PERMISSION_SET]

/** Role names the role builder must never create — owner is static. */
export const RESERVED_ROLE_NAMES: readonly string[] = ['owner']

export const permissionStringSchema = z
  .string()
  .refine((value) => VALID_PERMISSION_SET.has(value), 'Unknown permission.')

export const roleNameSchema = z
  .string()
  .trim()
  .min(2, 'Role name must be at least 2 characters.')
  .max(40, 'Role name is too long.')
  .regex(/^[a-zA-Z0-9 _-]+$/, 'Use letters, numbers, spaces, hyphens or underscores.')
  .refine(
    (value) => !RESERVED_ROLE_NAMES.includes(value.toLowerCase()),
    'That role name is reserved.'
  )

const organizationIdSchema = z.string().min(1, 'Organization ID is required.')

/* The member sheet sends an ENCODED role: a plain role name, `<name>|||<JSON
 * perms>` (named/admin role), or a bare `<JSON perms>` array (custom per-member
 * permissions). processRole (role.service) decodes it — so this is a loose
 * string, not roleNameSchema. */
export const encodedRoleSchema = z.string().min(1, 'A role is required.')

export const inviteMemberSchema = z.object({
  organizationId: organizationIdSchema,
  email: z.string().trim().min(1, 'Email is required.').email('Enter a valid email.'),
  role: encodedRoleSchema,
})

export const updateMemberSchema = z.object({
  organizationId: organizationIdSchema,
  memberId: z.string().min(1),
  role: encodedRoleSchema,
  permissions: z.array(permissionStringSchema),
})

export const removeMemberSchema = z.object({
  organizationId: organizationIdSchema,
  memberId: z.string().min(1),
})

export const cancelInvitationSchema = z.object({
  organizationId: organizationIdSchema,
  invitationId: z.string().min(1),
})

export const resendInvitationSchema = z.object({
  organizationId: organizationIdSchema,
  invitationId: z.string().min(1),
})

export const createRoleSchema = z.object({
  organizationId: organizationIdSchema,
  roleName: roleNameSchema,
  permissions: z.array(permissionStringSchema).min(1, 'Select at least one permission.'),
})

/* Role edit/delete are keyed by the OrganizationRole row id. */
export const updateRoleSchema = z.object({
  organizationId: organizationIdSchema,
  roleId: z.string().min(1),
  permissions: z.array(permissionStringSchema).min(1, 'Select at least one permission.'),
})

export const deleteRoleSchema = z.object({
  organizationId: organizationIdSchema,
  roleId: z.string().min(1),
})

/**
 * SOURCE OF TRUTH KEYWORDS: listMembersSchema, ListMembersValues,
 *   MEMBER_STATUS_FILTERS, MemberStatusFilter, TEAM_PAGE_SIZE, team table
 * WHAT:  member.list input: page, search (name or email), status tab
 *        (all, active, invited) and role filter.
 * WHERE: member.list; MemberManager (team table).
 */
export const TEAM_PAGE_SIZE = 10
export const MEMBER_STATUS_FILTERS = ['all', 'active', 'invited'] as const
export type MemberStatusFilter = (typeof MEMBER_STATUS_FILTERS)[number]
export const listMembersSchema = z.object({
  organizationId: z.string().min(1),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  search: z.string().trim().max(120).optional(),
  status: z.enum(MEMBER_STATUS_FILTERS).optional(),
  role: z.string().trim().max(60).optional(),
})
export type ListMembersValues = z.infer<typeof listMembersSchema>

export type InviteMemberValues = z.infer<typeof inviteMemberSchema>
export type UpdateMemberValues = z.infer<typeof updateMemberSchema>
export type CreateRoleValues = z.infer<typeof createRoleSchema>
export type UpdateRoleValues = z.infer<typeof updateRoleSchema>
