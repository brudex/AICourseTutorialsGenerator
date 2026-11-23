/**
 * SOURCE OF TRUTH KEYWORDS: aiProvidersRouter, aiProviders.list,
 *   aiProviders.create, aiProviders.testConnection, aiProviders.upsertModel,
 *   aiProviders.setRoute, aiProviders.applyPreset, aiProviders.autoSetup, aiProviders.listVoices,
 *   bring-your-own-key
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
import { AiCapability } from '@/generated/prisma'
import { permissions } from '@/lib/permissions'
import {
  aiCapabilitySchema,
  applyRoutingPresetSchema,
  autoSetupProviderSchema,
  createAiProviderSchema,
  listModelVoicesSchema,
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
  listModelVoices,
  synthesizeSpeech,
  testProviderConnection,
  verifyProviderCredentials,
} from '@/lib/ai'
import { AI_CAPABILITY_LABELS, AI_PROVIDER_PRESETS, modelVoicesFor, planAutoSetup } from '@/lib/config'
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

/* Matched by name and code, not `instanceof`: Next can load the Prisma runtime
 * twice (bundled and external), and then `instanceof` misses the error and
 * the raw "Unique constraint failed" message reaches the user. */
function prismaErrorCode(error: unknown): string | null {
  if (!(error instanceof Error) || error.name !== 'PrismaClientKnownRequestError') return null
  return 'code' in error && typeof error.code === 'string' ? error.code : null
}

function isUniqueViolation(error: unknown): boolean {
  return prismaErrorCode(error) === 'P2002'
}

function isNotFound(error: unknown): boolean {
  return prismaErrorCode(error) === 'P2025'
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
      return verifyProviderCredentials(input.kind, { baseUrl: input.baseUrl, apiKey })
    }),

  upsertModel: protectedProcedure({
    requirePermission: permissions.AI_PROVIDERS_UPDATE,
    audit: { action: 'upsertModel', describe: 'Saved AI model {output.displayName}' },
  })
    .input(upsertAiModelSchema)
    .mutation(async ({ ctx, input }) => {
      const provider = await aiProviderService.findProviderCredentials(ctx.db, input.organizationId, input.providerId)
      if (!provider) throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider not found.' })
      /* Voice only providers (ElevenLabs) cannot serve text or image capabilities. */
      const allowed = AI_PROVIDER_PRESETS[provider.kind].allowedCapabilities
      if (allowed && input.capabilities.some((c) => !allowed.includes(c))) {
        const labels = allowed.map((c) => AI_CAPABILITY_LABELS[c].label).join(', ')
        throw new TRPCError({ code: 'BAD_REQUEST', message: `${AI_PROVIDER_PRESETS[provider.kind].label} models can only be used for ${labels}.` })
      }

      const data = {
        modelId: input.modelId,
        displayName: input.displayName,
        capabilities: input.capabilities,
        inputPricePerMTok: input.inputPricePerMTok,
        outputPricePerMTok: input.outputPricePerMTok,
        supportsJsonSchema: input.supportsJsonSchema,
        contextWindow: input.contextWindow,
        /* Only Narration models keep voices; duplicates are dropped, order kept. */
        voices: input.capabilities.includes(AiCapability.TTS) ? [...new Set(input.voices)] : [],
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
        rethrowKnown(error, `${input.modelId} is already added to this provider. Edit it in the models list instead.`)
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

  /* Every saved voice, one per TTS model. */
  listVoiceProfiles: protectedProcedure({ requirePermission: permissions.AI_PROVIDERS_READ })
    .input(orgInput)
    .query(({ ctx, input }) => voiceService.listVoiceProfiles(ctx.db, input.organizationId)),

  /* Query: lists one model's voices live from its provider, outside any transaction. */
  listVoices: protectedProcedure({ requirePermission: permissions.AI_PROVIDERS_READ })
    .input(listModelVoicesSchema)
    .query(async ({ input }) => {
      const voices = await listModelVoices(input.organizationId, input.aiModelId)
      if (!voices) throw new TRPCError({ code: 'NOT_FOUND', message: 'Model not found in this workspace.' })
      return voices
    }),

  saveVoice: protectedProcedure({
    requirePermission: permissions.AI_PROVIDERS_UPDATE,
    audit: { action: 'saveVoice', describe: 'Set the narration voice to {input.voice}' },
  })
    .input(saveVoiceProfileSchema)
    .mutation(async ({ ctx, input }) => {
      /* The voice's model must be a voice model in THIS workspace. */
      const model = await aiProviderService.findModelWithCredentials(ctx.db, input.organizationId, input.aiModelId)
      if (!model) throw new TRPCError({ code: 'NOT_FOUND', message: 'Model not found in this workspace.' })
      if (!model.capabilities.includes(AiCapability.TTS)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'That model is not set up for Narration.' })
      }
      /* A typed voice id joins the model's own list, so it is offered next time. */
      const { voices } = modelVoicesFor(model.provider.kind, model.modelId, model.voices)
      if (!voices.some((v) => v.id === input.voice)) {
        await aiProviderService.updateModel(ctx.db, input.organizationId, model.id, {
          voices: [...voices.map((v) => v.id), input.voice],
        })
      }
      return voiceService.upsertVoiceProfile(ctx.db, input.organizationId, {
        aiModelId: input.aiModelId,
        voice: input.voice,
        speed: input.speed,
        instructions: input.instructions,
      })
    }),

  /* Query, not mutation: a provider call must not hold a DB transaction.
   * Plays the unsaved form values on the chosen model and returns a short
   * sample as a data URL the browser can play directly. */
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
          profiles: [{ aiModelId: input.aiModelId, voice: input.voice, speed: input.speed, instructions: input.instructions }],
          aiModelId: input.aiModelId,
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

  /* "Set up for me": adds the recommended models the key offers and routes every capability to them. */
  autoSetup: protectedProcedure({
    requirePermission: permissions.AI_PROVIDERS_UPDATE,
    audit: { action: 'autoSetup', describe: 'Set up recommended AI models automatically' },
  })
    .input(autoSetupProviderSchema)
    .mutation(async ({ ctx, input }) => {
      const provider = await aiProviderService.findProviderCredentials(ctx.db, input.organizationId, input.providerId)
      if (!provider) throw new TRPCError({ code: 'NOT_FOUND', message: 'Provider not found.' })
      const plan = planAutoSetup(provider.kind, input.availableModelIds)
      if (plan.models.length === 0) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'There are no recommended models for this provider yet. Add models yourself with Add model.' })
      }

      const existing = await aiProviderService.listModelsForProvider(ctx.db, input.organizationId, provider.id)
      /* One entry per model id, so a plan naming a model twice cannot create it twice. */
      const suggestions = [...new Map(plan.models.map((s) => [s.modelId, s])).values()]
      for (const suggestion of suggestions) {
        const found = existing.find((m) => m.modelId === suggestion.modelId)
        if (!found) continue
        /* Keep the user's own entry; just make sure it can serve its new jobs. */
        const capabilities = [...new Set([...found.capabilities, ...suggestion.capabilities])]
        if (capabilities.length !== found.capabilities.length || !found.isEnabled) {
          await aiProviderService.updateModel(ctx.db, input.organizationId, found.id, { capabilities, isEnabled: true })
        }
      }
      /* Missing models are added in one statement that skips ids another run already added. */
      const added = await aiProviderService.createModelsIfMissing(
        ctx.db,
        suggestions
          .filter((s) => !existing.some((m) => m.modelId === s.modelId))
          .map((s) => ({
            organizationId: input.organizationId,
            providerId: provider.id,
            modelId: s.modelId,
            displayName: s.displayName,
            capabilities: s.capabilities,
            supportsJsonSchema: s.supportsJsonSchema,
          }))
      )
      const saved = await aiProviderService.listModelsForProvider(ctx.db, input.organizationId, provider.id)
      const idByModel = new Map(saved.map((m) => [m.modelId, m.id]))

      const routes = await aiProviderService.listCapabilityRoutes(ctx.db, input.organizationId)
      const routed: AiCapability[] = []
      for (const capability of Object.values(AiCapability)) {
        const modelId = plan.routes[capability]
        const id = modelId ? idByModel.get(modelId) : undefined
        if (!id) continue
        const current = routes.find((r) => r.capability === capability)
        /* The old primary becomes the fallback; the fallback must differ from the primary. */
        const previous = current?.modelId !== id ? (current?.modelId ?? null) : (current?.fallbackModelId ?? null)
        await aiProviderService.upsertCapabilityRoute(ctx.db, input.organizationId, capability, id, previous === id ? null : previous)
        routed.push(capability)
      }
      return { added, kept: suggestions.length - added, routed }
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
