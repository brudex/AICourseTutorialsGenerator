/**
 * SOURCE OF TRUTH KEYWORDS: dashboardUsageSchema, DashboardUsageValues,
 *   USAGE_RANGES, UsageRange, studio dashboard inputs
 *
 * WHAT:  Inputs of the studio dashboard: the AI usage time range.
 * WHERE: dashboard router (usage); DashboardUsageCard range toggle.
 */

import { z } from 'zod'

export const USAGE_RANGES = [7, 30, 90] as const
export type UsageRange = (typeof USAGE_RANGES)[number]

export const dashboardUsageSchema = z.object({
  organizationId: z.string().min(1),
  days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
})

export type DashboardUsageValues = z.infer<typeof dashboardUsageSchema>
