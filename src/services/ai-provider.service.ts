import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: aiProviderService, AI_PROVIDER_SAFE_SELECT,
 *   AI_MODEL_SELECT, MODEL_WITH_CREDENTIALS_SELECT, listProvidersWithModels,
 *   findRouteForCapability, findAgentOverride, createUsageEvent,
 *   replaceCapabilityRoutes, listRoutingCandidates
 *
 * WHAT:  Pure Prisma reads/writes for AI providers, models, capability
 *        routes, agent overrides, and the AiUsageEvent cost ledger.
 * WHY:   Services are the only DB layer (CLAUDE.md §3). Every function takes a
 *        DbClient so it runs inside a router's transaction OR from the worker
 *        with the plain client. Every query is scoped by organizationId.
 *        SECURITY: AI_PROVIDER_SAFE_SELECT omits apiKeyCiphertext and is the
 *        ONLY select used for anything returned to a client.
 *        MODEL_WITH_CREDENTIALS_SELECT includes the ciphertext and is used
 *        solely by the AI Gateway — its results must never leave the server.
 * WHERE: src/trpc/routers/ai-providers.ts and src/lib/ai (routing, gateway).
 */

import type { AiCapability, Prisma } from '@/generated/prisma'
import type { DbClient } from '@/lib/config'

export const AI_PROVIDER_SAFE_SELECT = {
  id: true,
  name: true,
  kind: true,
  baseUrl: true,
  apiKeyLast4: true,
  isEnabled: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AiProviderSelect

export const AI_MODEL_SELECT = {
  id: true,
  providerId: true,
  modelId: true,
  displayName: true,
  capabilities: true,
  inputPricePerMTok: true,
  outputPricePerMTok: true,
  supportsJsonSchema: true,
  contextWindow: true,
  isEnabled: true,
  createdAt: true,
} satisfies Prisma.AiModelSelect

/* Server-only: carries the encrypted key for the gateway. */
export const MODEL_WITH_CREDENTIALS_SELECT = {
  ...AI_MODEL_SELECT,
  provider: {
    select: { id: true, name: true, kind: true, baseUrl: true, apiKeyCiphertext: true, isEnabled: true },
  },
} satisfies Prisma.AiModelSelect

export type ModelWithCredentials = Prisma.AiModelGetPayload<{ select: typeof MODEL_WITH_CREDENTIALS_SELECT }>

// ── Providers ────────────────────────────────────────────────────────────

export function listProvidersWithModels(db: DbClient, organizationId: string) {
  return db.aiProvider.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
    select: {
      ...AI_PROVIDER_SAFE_SELECT,
      models: { select: AI_MODEL_SELECT, orderBy: { createdAt: 'asc' } },
    },
  })
}

export function findProviderCredentials(db: DbClient, organizationId: string, providerId: string) {
  return db.aiProvider.findFirst({
    where: { id: providerId, organizationId },
    select: { id: true, name: true, kind: true, baseUrl: true, apiKeyCiphertext: true, isEnabled: true },
  })
}

export function createProvider(db: DbClient, data: Prisma.AiProviderUncheckedCreateInput) {
  return db.aiProvider.create({ data, select: AI_PROVIDER_SAFE_SELECT })
}

export function updateProvider(
  db: DbClient,
  organizationId: string,
  id: string,
  data: Prisma.AiProviderUncheckedUpdateInput
) {
  return db.aiProvider.update({ where: { id, organizationId }, data, select: AI_PROVIDER_SAFE_SELECT })
}

export function deleteProvider(db: DbClient, organizationId: string, id: string) {
  return db.aiProvider.delete({ where: { id, organizationId }, select: { id: true, name: true } })
}

// ── Models ───────────────────────────────────────────────────────────────

export function findModel(db: DbClient, organizationId: string, id: string) {
  return db.aiModel.findFirst({ where: { id, organizationId }, select: AI_MODEL_SELECT })
}

export function createModel(db: DbClient, data: Prisma.AiModelUncheckedCreateInput) {
  return db.aiModel.create({ data, select: AI_MODEL_SELECT })
}

export function updateModel(
  db: DbClient,
  organizationId: string,
  id: string,
  data: Prisma.AiModelUncheckedUpdateInput
) {
  return db.aiModel.update({ where: { id, organizationId }, data, select: AI_MODEL_SELECT })
}

export function deleteModel(db: DbClient, organizationId: string, id: string) {
  return db.aiModel.delete({ where: { id, organizationId }, select: { id: true, displayName: true } })
}

/** Enabled models on enabled providers — what routing presets choose from. */
export function listRoutingCandidates(db: DbClient, organizationId: string) {
  return db.aiModel.findMany({
    where: { organizationId, isEnabled: true, provider: { isEnabled: true } },
    orderBy: { createdAt: 'asc' },
    select: AI_MODEL_SELECT,
  })
}

// ── Capability routes ────────────────────────────────────────────────────

export function listCapabilityRoutes(db: DbClient, organizationId: string) {
  return db.capabilityRoute.findMany({
    where: { organizationId },
    select: { id: true, capability: true, modelId: true, fallbackModelId: true },
  })
}

export function upsertCapabilityRoute(
  db: DbClient,
  organizationId: string,
  capability: AiCapability,
  modelId: string,
  fallbackModelId: string | null
) {
  return db.capabilityRoute.upsert({
    where: { organizationId_capability: { organizationId, capability } },
    create: { organizationId, capability, modelId, fallbackModelId },
    update: { modelId, fallbackModelId },
    select: { id: true, capability: true, modelId: true, fallbackModelId: true },
  })
}

export function deleteCapabilityRoute(db: DbClient, organizationId: string, capability: AiCapability) {
  return db.capabilityRoute.deleteMany({ where: { organizationId, capability } })
}

export async function replaceCapabilityRoutes(
  db: DbClient,
  organizationId: string,
  routes: ReadonlyArray<{ capability: AiCapability; modelId: string; fallbackModelId: string | null }>
) {
  await db.capabilityRoute.deleteMany({ where: { organizationId } })
  if (routes.length === 0) return { count: 0 }
  return db.capabilityRoute.createMany({
    data: routes.map((r) => ({ organizationId, ...r })),
  })
}

/** Gateway read: the route for a capability with both models' credentials. */
export function findRouteForCapability(db: DbClient, organizationId: string, capability: AiCapability) {
  return db.capabilityRoute.findUnique({
    where: { organizationId_capability: { organizationId, capability } },
    select: {
      model: { select: MODEL_WITH_CREDENTIALS_SELECT },
      fallbackModel: { select: MODEL_WITH_CREDENTIALS_SELECT },
    },
  })
}

/** Gateway read: every enabled model tagged for a capability, oldest first
 *  (spare models tried when the routed ones fail). */
export function listModelsForCapability(db: DbClient, organizationId: string, capability: AiCapability) {
  return db.aiModel.findMany({
    where: { organizationId, isEnabled: true, capabilities: { has: capability }, provider: { isEnabled: true } },
    orderBy: { createdAt: 'asc' },
    select: MODEL_WITH_CREDENTIALS_SELECT,
  })
}

/** Gateway read: a per-agent model pin, if one exists. */
export function findAgentOverride(db: DbClient, organizationId: string, agentId: string) {
  return db.agentModelOverride.findUnique({
    where: { organizationId_agentId: { organizationId, agentId } },
    select: { model: { select: MODEL_WITH_CREDENTIALS_SELECT } },
  })
}

// ── Cost ledger ──────────────────────────────────────────────────────────

export function createUsageEvent(db: DbClient, data: Prisma.AiUsageEventUncheckedCreateInput) {
  return db.aiUsageEvent.create({ data, select: { id: true } })
}
