/**
 * SOURCE OF TRUTH KEYWORDS: AiProviderRow, AiModelRow, CapabilityRouteRow,
 *   AiProvidersListOutput
 *
 * WHAT:  Client types for the AI Providers settings UI, derived from the
 *        aiProviders router output so they can't drift from the server.
 * WHY:   Same router-derived pattern as team/_components/member-types.ts.
 * WHERE: settings/ai-providers/_components/*.
 */

import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/trpc/routers/_app'

export type AiProvidersListOutput = inferRouterOutputs<AppRouter>['aiProviders']['list']
export type AiProviderRow = AiProvidersListOutput['providers'][number]
export type AiModelRow = AiProviderRow['models'][number]
export type CapabilityRouteRow = AiProvidersListOutput['routes'][number]
