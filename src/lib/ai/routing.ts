import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: resolveModelsForCall, resolveSpareModels, buildPresetRoutes,
 *   capability routing, model fallback, AgentModelOverride, RoutingPreset,
 *   PresetRoute
 *
 * WHAT:  (1) Decides which model(s) serve a call: agent override first, else
 *        the capability route's primary then fallback — disabled models or
 *        providers are skipped. (2) Builds the routing table for a preset.
 * WHY:   Agents ask for a capability, never a model (blueprint §23), so a
 *        model swap is a settings change, not a code change. Presets rank by
 *        blended price because it is the one quality proxy every workspace
 *        has filled in; ties keep registration order so results are stable.
 *        The fallback prefers a DIFFERENT provider so one provider's outage
 *        doesn't take out both slots.
 * WHERE: src/lib/ai/gateway.ts (resolveModelsForCall); aiProviders.applyPreset
 *        (buildPresetRoutes).
 */

import { AiCapability } from '@/generated/prisma'
import type { DbClient } from '@/lib/config'
import { AI_CAPABILITY_LABELS } from '@/lib/config/ai-providers'
import type { RoutingPreset } from '@/lib/types'
import * as aiProviderService from '@/services/ai-provider.service'
import type { ModelWithCredentials } from '@/services/ai-provider.service'
import { AiGatewayError } from './errors'

/* CAPABILITY_FALLBACK applies to text capabilities only — speech can never
 * be served by a text model. */
const TEXT_FALLBACK_CAPABILITIES: readonly AiCapability[] = [
  AiCapability.FAST_TEXT,
  AiCapability.CODING,
  AiCapability.LONG_CONTEXT,
]

function isUsable(model: ModelWithCredentials | null | undefined): model is ModelWithCredentials {
  return Boolean(model && model.isEnabled && model.provider.isEnabled)
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveModelsForCall
 *
 * WHAT:  Ordered list of models to try for one gateway call (1–2 entries).
 *        Unrouted FAST_TEXT / CODING / LONG_CONTEXT fall back to the
 *        STRONG_REASONING route (CAPABILITY_FALLBACK).
 * WHY:   Throws `not_configured` (non-retryable) with a user-facing pointer to
 *        settings, so a job fails fast instead of retrying a missing route.
 */
export async function resolveModelsForCall(
  db: DbClient,
  params: { organizationId: string; capability: AiCapability; agentId: string | null }
): Promise<ModelWithCredentials[]> {
  if (params.agentId) {
    const override = await aiProviderService.findAgentOverride(db, params.organizationId, params.agentId)
    if (isUsable(override?.model)) return [override.model]
  }

  /* A route only counts when its model is tagged for the capability, so a
   * route saved before that rule (e.g. a voice model on Fast text) falls
   * back instead of sending text prompts to a speech model. */
  const servesCapability = (capability: AiCapability) => (model: ModelWithCredentials | null | undefined) =>
    isUsable(model) && model.capabilities.includes(capability)
  const route = await aiProviderService.findRouteForCapability(db, params.organizationId, params.capability)
  let models = [route?.model, route?.fallbackModel].filter(isUsable).filter(servesCapability(params.capability))
  /* CAPABILITY_FALLBACK: a workspace with only a Strong-reasoning model set
   * can still run every agent — specialised capabilities borrow it. */
  if (models.length === 0 && TEXT_FALLBACK_CAPABILITIES.includes(params.capability)) {
    const general = await aiProviderService.findRouteForCapability(db, params.organizationId, AiCapability.STRONG_REASONING)
    models = [general?.model, general?.fallbackModel].filter(isUsable).filter(servesCapability(AiCapability.STRONG_REASONING))
  }
  if (models.length === 0) {
    const label = AI_CAPABILITY_LABELS[params.capability].label
    throw new AiGatewayError(
      'not_configured',
      `No enabled model is routed for “${label}”. Set one in Settings → AI Providers.`
    )
  }
  return models
}

/**
 * SOURCE OF TRUTH KEYWORDS: resolveSpareModels, spare model, automatic model
 *   fallback, SPARE_MODEL_AI_ERROR_KINDS
 *
 * WHAT:  The workspace's other enabled models for a capability, excluding the
 *        ones already tried. Structured calls list json_schema models first.
 *        Text capabilities (Fast text, Coding, Long context) then try the
 *        Strong reasoning models, as CAPABILITY_FALLBACK does above.
 * WHY:   A workspace often connects several models but routes only one. When
 *        that one keeps failing (e.g. returning malformed structured output),
 *        the call should not fail while a capable model sits unused.
 * WHERE: withFallback in src/lib/ai/gateway.ts, only after the routed models
 *        failed with a SPARE_MODEL_AI_ERROR_KINDS error.
 */
export async function resolveSpareModels(
  db: DbClient,
  params: { organizationId: string; capability: AiCapability; excludeIds: readonly string[]; preferJsonSchema: boolean }
): Promise<ModelWithCredentials[]> {
  let models = await aiProviderService.listModelsForCapability(db, params.organizationId, params.capability)
  /* Text capabilities always end with the Strong reasoning models: when the
   * only Fast text or Coding model is broken (e.g. a 404 "Model not exist"),
   * the job still runs on a model that can do it. */
  if (TEXT_FALLBACK_CAPABILITIES.includes(params.capability)) {
    const strong = await aiProviderService.listModelsForCapability(db, params.organizationId, AiCapability.STRONG_REASONING)
    models = [...models, ...strong.filter((model) => !models.some((own) => own.id === model.id))]
  }
  const spares = models.filter((model) => isUsable(model) && !params.excludeIds.includes(model.id))
  /* Stable sort: json_schema models first, otherwise registration order. */
  return params.preferJsonSchema
    ? [...spares].sort((a, b) => Number(b.supportsJsonSchema) - Number(a.supportsJsonSchema))
    : spares
}

type RoutingCandidate = Awaited<ReturnType<typeof aiProviderService.listRoutingCandidates>>[number]

export interface PresetRoute {
  capability: AiCapability
  modelId: string
  fallbackModelId: string | null
}

/* Capabilities where Balanced pays for quality; the rest go cheapest. */
const BALANCED_PREMIUM: readonly AiCapability[] = [AiCapability.STRONG_REASONING, AiCapability.CODING]

function blendedPrice(model: RoutingCandidate): number {
  return Number(model.inputPricePerMTok) + Number(model.outputPricePerMTok)
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildPresetRoutes
 *
 * WHAT:  Pure function: candidates + preset → one route per capability that
 *        at least one candidate supports. Capabilities with no candidate are
 *        left unrouted (the UI shows them as "not set").
 */
export function buildPresetRoutes(
  candidates: readonly RoutingCandidate[],
  preset: RoutingPreset
): PresetRoute[] {
  const routes: PresetRoute[] = []

  for (const capability of Object.values(AiCapability)) {
    const premium = preset === 'BEST_QUALITY' || (preset === 'BALANCED' && BALANCED_PREMIUM.includes(capability))
    const ranked = candidates
      .filter((m) => m.capabilities.includes(capability))
      /* Array.prototype.sort is stable, so equal prices keep registration order. */
      .sort((a, b) => (premium ? blendedPrice(b) - blendedPrice(a) : blendedPrice(a) - blendedPrice(b)))

    const primary = ranked[0]
    if (!primary) continue
    const fallback =
      ranked.slice(1).find((m) => m.providerId !== primary.providerId) ?? ranked[1] ?? null

    routes.push({ capability, modelId: primary.id, fallbackModelId: fallback?.id ?? null })
  }

  return routes
}

/**
 * SOURCE OF TRUTH KEYWORDS: hasRouteFor
 *
 * WHAT:  True when a usable model is routed for exactly this capability (no
 *        fallback). Used to decide whether optional stages (narration) are
 *        queued at all.
 */
export async function hasRouteFor(db: DbClient, organizationId: string, capability: AiCapability): Promise<boolean> {
  const route = await aiProviderService.findRouteForCapability(db, organizationId, capability)
  return [route?.model, route?.fallbackModel].some(isUsable)
}
