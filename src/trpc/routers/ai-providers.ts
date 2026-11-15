/**
 * SOURCE OF TRUTH KEYWORDS: aiProvidersRouter, aiProviders.list,
 *   aiProviders.create, aiProviders.testConnection, aiProviders.upsertModel,
 *   aiProviders.setRoute, aiProviders.applyPreset, bring-your-own-key
 *
 * WHAT:  Workspace AI provider connections, their models, and the capability
 *        routing table (Settings → AI Providers).
 * WHY:   protectedProcedure supplies auth, tenancy, aiProviders:* permission
 *        checks, transactions, and audit rows. This router holds only the
 *        business rules: encrypt keys before they touch the DB, never return
 *        ciphertext, keep models/routes inside the caller's workspace, and
 *        convert Decimal prices to numbers for the client.
 *        testConnection is a QUERY on purpose: mutations run inside a DB
 *        transaction, and holding one open across a network call to a
 *        provider would tie up a connection for up to 15 s.
 *        camelCase verbs pass an explicit audit override because the
 *        procedure builder lower-cases path verbs before registry lookup.
 * WHERE: Mounted as `aiProviders` in src/trpc/routers/_app.ts; consumed by
 *        src/app/(dashboard)/dashboard/settings/ai-providers.
 */

import { z } from 'zod'
import { TRPCError } from '@trpc/server'

import { createTRPCRouter } from '../init'
import { protectedProcedure } from '../procedures'
import { Prisma } from '@/generated/prisma'
import { permissions } from '@/lib/permissions'
import {
  aiCapabilitySchema,
  applyRoutingPresetSchema,
  createAiProviderSchema,
  saveVoiceProfileSchema,
  verifyAiProviderSchema,
  setCapabilityRouteSchema,
  updateAiProviderSchema,
  upsertAiModelSchema,
} from '@/lib/types'
import {
  AiGatewayError,
  apiKeyLast4,
  buildPresetRoutes,
  decryptApiKey,
  encryptApiKey,
  synthesizeSpeech,
  testProviderConnection,
  verifyProviderCredentials,
} from '@/lib/ai'
import { DEFAULT_VOICE } from '@/lib/config'
import * as voiceService from '@/services/voice.service'
import * as aiProviderService from '@/services/ai-provider.service'

type ModelRow = Awaited<ReturnType<typeof aiProviderService.listProvidersWithModels>>[number]['models'][number]

/* Prisma Decimal does not survive superjson; the client gets plain numbers. */
function toClientModel(model: ModelRow) {
  return {
    ...model,
    inputPricePerMTok: Number(model.inputPricePerMTok),
    outputPricePerMTok: Number(model.outputPricePerMTok),
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

function isNotFound(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025'
}

/* Maps the two Prisma errors users can trigger to readable tRPC errors. */
function rethrowKnown(error: unknown, conflictMessage: string): never {
  if (isUniqueViolation(error)) throw new TRPCError({ code: 'CONFLICT', message: conflictMessage })
  if (isNotFound(error)) throw new TRPCError({ code: 'NOT_FOUND', message: 'That item no longer exists.' })
  throw error
}

const orgInput = z.object({ organizationId: z.string().min(1) })
const idInput = orgInput.extend({ id: z.string().min(1) })

export const aiProvidersRouter = createTRPCRouter({
  list: protectedProcedure({ requirePermission: permissions.AI_PROVIDERS_READ })
    .input(orgInput)
    .query(async ({ ctx, input }) => {
      const [providers, routes] = await Promise.all([
        aiProviderService.listProvidersWithModels(ctx.db, input.organizationId),
        aiProviderService.listCapabilityRoutes(ctx.db, input.organizationId),
      ])
      return {
        providers: providers.map((p) => ({ ...p, models: p.models.map(toClientModel) })),
        routes,
      }
    }),

  create: protectedProcedure({ requirePermission: permissions.AI_PROVIDERS_CREATE })
    .input(createAiProviderSchema)
    .mutation(async ({ ctx, input }) => {
      const hasKey = input.apiKey.length > 0
      try {
        return await aiProviderService.createProvider(ctx.db, {
          organizationId: input.organizationId,
          name: input.name,
          kind: input.kind,
          baseUrl: input.baseUrl,
          apiKeyCiphertext: hasKey ? encryptApiKey(input.apiKey) : null,
          apiKeyLast4: hasKey ? apiKeyLast4(input.apiKey) : null,
        })
      } catch (error) {
        rethrowKnown(error, 'A provider with that name already exists.')
      }
    }),

  update: protectedProcedure({ requirePermission: permissions.AI_PROVIDERS_UPDATE })
    .input(updateAiProviderSchema)
    .mutation(async ({ ctx, input }) => {
      /* Blank key = keep the stored one; the client never holds the old key. */
      const keyUpdate =
        input.apiKey.length > 0
          ? { apiKeyCiphertext: encryptApiKey(input.apiKey), apiKeyLast4: apiKeyLast4(input.apiKey) }
          : {}
      try {
        return await aiProviderService.updateProvider(ctx.db, input.organizationId, input.id, {
          name: input.name,
          baseUrl: input.baseUrl,
          isEnabled: input.isEnabled,
          ...keyUpdate,
        })
      } catch (error) {
        rethrowKnown(error, 'A provider with that name already exists.')
      }
    }),

  delete: protectedProcedure({ requirePermission: permissions.AI_PROVIDERS_DELETE })
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await aiProviderService.deleteProvider(ctx.db, input.organizationId, input.id)
      } catch (error) {
        rethrowKnown(error, 'Could not delete this provider.')
      }
    }),

  /* Query, not mutation — see file header. Uses the stored key server-side. */
  testConnection: protectedProcedure({ requirePermission: permissions.AI_PROVIDERS_UPDATE })
    .input(idInput)
    .query(async ({ ctx, input }) => {
      const result = await testProviderConnection(ctx.db, input.organizationId, input.id)
      if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider not found.' })
      return result
    }),

  /* Pre-save credential check (query: no transaction around a network call).
   * Allowed for anyone who may create OR update providers; reading a stored
   * key (blank apiKey + providerId) additionally needs update rights. */
  verifyCredentials: protectedProcedure()
    .input(verifyAiProviderSchema)
    .query(async ({ ctx, input }) => {
      const perms = ctx.organization.permissions
      const canCreate = ctx.memberHasFullAccess || perms.includes(permissions.AI_PROVIDERS_CREATE)
      const canUpdate = ctx.memberHasFullAccess || perms.includes(permissions.AI_PROVIDERS_UPDATE)
      if (!canCreate && !canUpdate) throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot manage AI providers.' })

      let apiKey: string | null = input.apiKey.length > 0 ? input.apiKey : null
      if (!apiKey && input.providerId) {
        if (!canUpdate) throw new TRPCError({ code: 'FORBIDDEN', message: 'You cannot edit this provider.' })
        const stored = await aiProviderService.findProviderCredentials(ctx.db, input.organizationId, input.providerId)
        if (!stored) throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider not found.' })
        apiKey = stored.apiKeyCiphertext ? decryptApiKey(stored.apiKeyCiphertext) : null
      }
      return verifyProviderCredentials({ baseUrl: input.baseUrl, apiKey })
    }),

  upsertModel: protectedProcedure({
    requirePermission: permissions.AI_PROVIDERS_UPDATE,
    audit: { action: 'upsertModel', describe: 'Saved AI model {output.displayName}' },
  })
    .input(upsertAiModelSchema)
    .mutation(async ({ ctx, input }) => {
      const provider = await aiProviderService.findProviderCredentials(ctx.db, input.organizationId, input.providerId)
      if (!provider) throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider not found.' })

      const data = {
        modelId: input.modelId,
        displayName: input.displayName,
        capabilities: input.capabilities,
        inputPricePerMTok: input.inputPricePerMTok,
        outputPricePerMTok: input.outputPricePerMTok,
        supportsJsonSchema: input.supportsJsonSchema,
        contextWindow: input.contextWindow,
        isEnabled: input.isEnabled,
      }
      try {
        const model = input.id
          ? await aiProviderService.updateModel(ctx.db, input.organizationId, input.id, data)
          : await aiProviderService.createModel(ctx.db, {
              ...data,
              organizationId: input.organizationId,
              providerId: input.providerId,
            })
        return toClientModel(model)
      } catch (error) {
        rethrowKnown(error, 'This provider already has a model with that id.')
      }
    }),

  deleteModel: protectedProcedure({
    requirePermission: permissions.AI_PROVIDERS_UPDATE,
    audit: { action: 'deleteModel', describe: 'Removed AI model {output.displayName}' },
  })
    .input(idInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await aiProviderService.deleteModel(ctx.db, input.organizationId, input.id)
      } catch (error) {
        rethrowKnown(error, 'Could not delete this model.')
      }
    }),

  setRoute: protectedProcedure({
    requirePermission: permissions.AI_PROVIDERS_UPDATE,
    audit: { action: 'setRoute', describe: 'Routed {input.capability} to model {input.modelId}' },
  })
    .input(setCapabilityRouteSchema)
    .mutation(async ({ ctx, input }) => {
      /* Both models must belong to THIS workspace — ids alone prove nothing. */
      const ids = [input.modelId, input.fallbackModelId].filter((id): id is string => id !== null)
      const found = await Promise.all(ids.map((id) => aiProviderService.findModel(ctx.db, input.organizationId, id)))
      if (found.some((m) => m === null)) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Model not found in this workspace.' })
      }
      /* A model only serves capabilities it is tagged with (no voice model writing quizzes). */
      if (found.some((m) => m !== null && !m.capabilities.includes(input.capability))) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That model is not set up for this capability. Edit the model to add it.' })
      }
      return aiProviderService.upsertCapabilityRoute(
        ctx.db,
        input.organizationId,
        input.capability,
        input.modelId,
        input.fallbackModelId
      )
    }),

  clearRoute: protectedProcedure({
    requirePermission: permissions.AI_PROVIDERS_UPDATE,
    audit: { action: 'clearRoute', describe: 'Cleared routing for {input.capability}' },
  })
    .input(orgInput.extend({ capability: aiCapabilitySchema }))
    .mutation(async ({ ctx, input }) => {
      await aiProviderService.deleteCapabilityRoute(ctx.db, input.organizationId, input.capability)
      return { capability: input.capability }
    }),

  getVoice: protectedProcedure({ requirePermission: permissions.AI_PROVIDERS_READ })
    .input(orgInput)
    .query(async ({ ctx, input }) => {
      const voice = await voiceService.findDefaultVoice(ctx.db, input.organizationId)
      return voice ?? { id: null, name: 'Default narrator', ...DEFAULT_VOICE }
    }),

  saveVoice: protectedProcedure({
    requirePermission: permissions.AI_PROVIDERS_UPDATE,
    audit: { action: 'saveVoice', describe: 'Set the narration voice to {input.voice}' },
  })
    .input(saveVoiceProfileSchema)
    .mutation(({ ctx, input }) =>
      voiceService.upsertDefaultVoice(ctx.db, input.organizationId, {
        voice: input.voice,
        speed: input.speed,
        instructions: input.instructions,
      })
    ),

  /* Query, not mutation: a provider call must not hold a DB transaction.
   * Returns a short sample as a data URL the browser can play directly. */
  previewVoice: protectedProcedure({ requirePermission: permissions.AI_PROVIDERS_UPDATE })
    .input(saveVoiceProfileSchema)
    .query(async ({ input }) => {
      try {
        const speech = await synthesizeSpeech({
          context: {
            organizationId: input.organizationId,
            agentId: 'voicePreview',
            courseId: null,
            lessonId: null,
            jobId: null,
            taskId: null,
          },
          text: 'Welcome to the course. In this lesson, we will build something practical together, one step at a time.',
          voice: input.voice,
          speed: input.speed,
          instructions: input.instructions,
        })
        return {
          dataUrl: `data:${speech.mimeType};base64,${Buffer.from(speech.audio).toString('base64')}`,
          durationMs: speech.durationMs,
          model: speech.model.displayName,
        }
      } catch (error) {
        if (error instanceof AiGatewayError) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message })
        throw error
      }
    }),

  applyPreset: protectedProcedure({
    requirePermission: permissions.AI_PROVIDERS_UPDATE,
    audit: { action: 'applyPreset', describe: 'Applied the {input.preset} routing preset' },
  })
    .input(applyRoutingPresetSchema)
    .mutation(async ({ ctx, input }) => {
      const candidates = await aiProviderService.listRoutingCandidates(ctx.db, input.organizationId)
      if (candidates.length === 0) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: 'Add at least one enabled model before applying a preset.',
        })
      }
      const routes = buildPresetRoutes(candidates, input.preset)
      await aiProviderService.replaceCapabilityRoutes(ctx.db, input.organizationId, routes)
      return { preset: input.preset, routedCapabilities: routes.length }
    }),
})
