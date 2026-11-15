/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: portalRouter, portalProcedure, getSettings,
 *   updateSettings, platform settings
 *
 * WHAT:  Platform-admin (portal) endpoints — a public-to-any-user `getAccess`
 *        plus admin-gated cross-tenant reads (organizations, users, overview,
 *        activity) and the operator settings editor (getSettings,
 *        updateSettings).
 * WHY:   Portal data spans ALL organizations, so these run on authProcedure (an
 *        identity, no org scope) rather than the org-scoped protectedProcedure.
 *        `portalProcedure` adds the platform-admin gate (owner email or portal
 *        membership) on top. `getAccess` stays ungated so the tenant UI can ask
 *        "should I show the Platform-admin link?" for the current user.
 * WHERE: Mounted as `portal` in src/trpc/routers/_app. Delegates to
 *        src/services/portal.service and src/services/platform-setting.service.
 */

import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { createTRPCRouter } from '../init'
import { authProcedure } from '../procedures'
import { isPortalEnabled } from '@/lib/config/portal'
import { PLATFORM_SETTING_GROUPS, platformSettingGroup } from '@/lib/config/platform-settings'
import { apiKeyLast4, encryptApiKey } from '@/lib/ai/crypto'
import { refreshPlatformSettings, resolvePlatformSetting } from '@/lib/platform-settings'
import { ensurePlatformSettings } from '@/lib/platform-settings/loader'
import {
  platformSettingsGroupFormSchema,
  updatePlatformSettingsSchema,
  type PlatformSettingState,
  type PlatformSettingsView,
} from '@/lib/types'
import {
  resolvePortalAdmin,
  listAllOrganizations,
  listAllUsers,
  getPortalOverview,
  listPlatformActivity,
} from '@/services/portal.service'
import * as platformSettingService from '@/services/platform-setting.service'

const PORTAL_PAGE_SIZE = 25

function pageInput() {
  return z.object({ page: z.number().int().positive().optional() })
}

function toSkip(page: number | undefined): number {
  return ((page ?? 1) - 1) * PORTAL_PAGE_SIZE
}

/* Platform-admin gate: logged-in AND (owner email OR portal-org member). */
const portalProcedure = authProcedure.use(async ({ ctx, next }) => {
  const isAdmin = await resolvePortalAdmin({ id: ctx.user.id, email: ctx.user.email })
  if (!isAdmin) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Platform admin access required' })
  }
  return next()
})

/**
 * SOURCE OF TRUTH KEYWORDS: buildPlatformSettingsView, PlatformSettingsView
 *
 * WHAT:  The resolved state of every registry setting for the portal form.
 * WHY:   Secrets leave the server only as "set or not" plus their last four
 *        characters; everything else carries its effective value and source
 *        (saved here, server file, or default) so the operator sees what is
 *        actually in force.
 * WHERE: portal.getSettings.
 */
async function buildPlatformSettingsView(): Promise<PlatformSettingsView> {
  await ensurePlatformSettings()
  await refreshPlatformSettings()
  const rows = new Map((await platformSettingService.listPlatformSettings()).map((row) => [row.key, row]))
  return PLATFORM_SETTING_GROUPS.flatMap((group) =>
    group.fields.map((field): PlatformSettingState => {
      const { value, source } = resolvePlatformSetting(field.key)
      const isSecret = 'secret' in field && field.secret
      const hasValue = source !== 'default' && value.length > 0
      return {
        key: field.key,
        value: isSecret ? '' : value,
        source,
        hasValue,
        last4: isSecret && hasValue ? apiKeyLast4(value) : null,
        updatedAt: rows.get(field.key)?.updatedAt ?? null,
      }
    })
  )
}

export const portalRouter = createTRPCRouter({
  /* Ungated (authed): lets the tenant UI decide whether to surface the portal
   * link for the current user without leaking who the owner is. */
  getAccess: authProcedure.query(async ({ ctx }) => ({
    enabled: isPortalEnabled(),
    isPortalAdmin: await resolvePortalAdmin({ id: ctx.user.id, email: ctx.user.email }),
  })),

  getOverview: portalProcedure.query(() => getPortalOverview()),

  listOrganizations: portalProcedure
    .input(pageInput())
    .query(({ input }) => listAllOrganizations(toSkip(input.page), PORTAL_PAGE_SIZE)),

  listUsers: portalProcedure
    .input(pageInput())
    .query(({ input }) => listAllUsers(toSkip(input.page), PORTAL_PAGE_SIZE)),

  listActivity: portalProcedure
    .input(pageInput())
    .query(({ input }) => listPlatformActivity(toSkip(input.page), PORTAL_PAGE_SIZE)),

  getSettings: portalProcedure.query(() => buildPlatformSettingsView()),

  /* Saves one group. Blank text clears the saved value (falls back to the
   * server file or default); a blank secret keeps the saved one unless it is
   * listed in `clear`. Refreshes this process at once; others within seconds. */
  updateSettings: portalProcedure.input(updatePlatformSettingsSchema).mutation(async ({ ctx, input }) => {
    const group = platformSettingGroup(input.groupId)
    if (!group) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Unknown settings group' })
    const parsed = platformSettingsGroupFormSchema(group).safeParse(input.values)
    if (!parsed.success) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: parsed.error.issues[0]?.message ?? 'Invalid settings' })
    }

    const groupKeys = new Set(group.fields.map((field) => field.key))
    const clear = new Set(input.clear.filter((key) => groupKeys.has(key)))
    const upserts: Array<{ key: string; value: string; isSecret: boolean }> = []
    const deletes: string[] = [...clear]

    for (const field of group.fields) {
      const value = (parsed.data[field.key] ?? '').trim()
      if (clear.has(field.key)) continue
      if (field.secret) {
        if (value) upserts.push({ key: field.key, value: encryptApiKey(value), isSecret: true })
      } else if (value) {
        upserts.push({ key: field.key, value, isSecret: false })
      } else {
        deletes.push(field.key)
      }
    }

    await platformSettingService.savePlatformSettings({ upserts, deletes, updatedById: ctx.user.id })
    await ensurePlatformSettings()
    await refreshPlatformSettings()
    return { saved: upserts.length, cleared: deletes.length }
  }),
})
