'use client'

/**
 * SOURCE OF TRUTH KEYWORDS:⁠​‌‌​​‌‌​​‌​‌‌‌​​‌‌​‌​​​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​‌‌‌‌​​​‌​​‌​‌​​​‌​​‌‌‌⁠ AiProvidersSettings, AI Providers page,
 *   provider list, model list, test connection, capability routing section
 *
 * WHAT:  The AI Providers settings screen: connected providers (with
 *        connection test), their models, and the capability routing table.
 * WHY:   Three SettingsSections in the same layout as Organization settings so
 *        the screen reads as part of the app. Write controls render only for
 *        members holding the matching aiProviders permission; the server
 *        enforces the same checks regardless. Connection-test results are kept
 *        per provider; the model dialog loads the provider's model list itself.
 * WHERE: settings/ai-providers/page.tsx.
 */

import * as React from 'react'
import { PlusIcon } from 'lucide-react'

import { AiCapability } from '@/generated/prisma'
import { trpc } from '@/trpc/react-provider'
import { useActiveOrganization, useActiveOrganizationId } from '@/hooks/use-active-organization'
import { permissions } from '@/lib/permissions'
import { AI_CAPABILITY_LABELS, AI_PROVIDER_PRESETS } from '@/lib/config'
import type { NarrationModelChoice } from '@/lib/types'
import { SettingsSection } from '@/components/global/settings-section'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
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
import type { AiModelRow, AiProviderRow } from './ai-provider-types'
import { ProviderDialog } from './provider-dialog'
import { ModelDialog } from './model-dialog'
import { RoutingTable } from './routing-table'
import { NarrationVoiceForm } from './narration-voice-form'
import { AddModelGate, ProviderStatusLine, TestConnectionButton } from './provider-status'
import { AutoSetupButton, canAutoSetup } from './auto-setup-button'

type PendingDelete =
  | { type: 'provider'; id: string; name: string }
  | { type: 'model'; id: string; name: string }

function formatPrice(value: number): string {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 4 })}`
}

export function AiProvidersSettings() {
  const organizationId = useActiveOrganizationId()
  const { hasPermission } = useActiveOrganization()
  const orgId = organizationId ?? ''
  const utils = trpc.useUtils()

  const list = trpc.aiProviders.list.useQuery({ organizationId: orgId }, { enabled: organizationId !== undefined })
  const voiceProfiles = trpc.aiProviders.listVoiceProfiles.useQuery({ organizationId: orgId }, { enabled: organizationId !== undefined })
  const deleteProvider = trpc.aiProviders.delete.useMutation()
  const deleteModel = trpc.aiProviders.deleteModel.useMutation()

  const canCreate = hasPermission(permissions.AI_PROVIDERS_CREATE)
  const canUpdate = hasPermission(permissions.AI_PROVIDERS_UPDATE)
  const canDelete = hasPermission(permissions.AI_PROVIDERS_DELETE)

  const [providerDialog, setProviderDialog] = React.useState<{ open: boolean; provider: AiProviderRow | null }>({
    open: false,
    provider: null,
  })
  const [modelDialog, setModelDialog] = React.useState<{ provider: AiProviderRow; model: AiModelRow | null } | null>(
    null
  )
  const [pendingDelete, setPendingDelete] = React.useState<PendingDelete | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  async function confirmDelete() {
    if (!pendingDelete) return
    setError(null)
    try {
      if (pendingDelete.type === 'provider') {
        await deleteProvider.mutateAsync({ organizationId: orgId, id: pendingDelete.id })
      } else {
        await deleteModel.mutateAsync({ organizationId: orgId, id: pendingDelete.id })
      }
      await Promise.all([
        utils.aiProviders.list.invalidate({ organizationId: orgId }),
        utils.aiProviders.listVoices.invalidate({ organizationId: orgId }),
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete.')
    } finally {
      setPendingDelete(null)
    }
  }

  if (!organizationId) return null

  if (list.isLoading) {
    return <Skeleton className="h-48 w-full" />
  }
  if (list.error) {
    return <p className="text-sm text-destructive">{list.error.message}</p>
  }

  const providers = list.data?.providers ?? []
  const routes = list.data?.routes ?? []
  /* Enabled voice models for the voice picker, tagged with their Narration role. */
  const narrationRoute = routes.find((r) => r.capability === AiCapability.TTS)
  const voiceModels: NarrationModelChoice[] = providers.flatMap((p) =>
    p.models
      .filter((m) => p.isEnabled && m.isEnabled && m.capabilities.includes(AiCapability.TTS))
      .map((m) => ({
        id: m.id,
        displayName: m.displayName,
        providerName: p.name,
        role: m.id === narrationRoute?.modelId ? 'primary' : m.id === narrationRoute?.fallbackModelId ? 'fallback' : null,
      }))
  )

  return (
    <div className="space-y-10">
      <SettingsSection
        title="Providers"
        description="Connect the AI services your agents use"
        label="Connections"
        labelDescription="Any OpenAI-compatible API. Keys are encrypted."
        contentWidth="full"
      >
        <div className="space-y-3">
          {providers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No providers connected yet.</p>
          ) : (
            <div className="divide-y rounded-lg border">
              {providers.map((provider) => {
                return (
                  <div key={provider.id} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{provider.name}</p>
                        <Badge variant="outline">{AI_PROVIDER_PRESETS[provider.kind].label}</Badge>
                        {!provider.isEnabled ? <Badge variant="secondary">Disabled</Badge> : null}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {provider.baseUrl}
                        {provider.apiKeyLast4 ? ` · key ••••${provider.apiKeyLast4}` : ' · no key'}
                        {` · ${provider.models.length} model${provider.models.length === 1 ? '' : 's'}`}
                      </p>
                      <ProviderStatusLine organizationId={orgId} provider={provider} canCheck={canUpdate} />
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <TestConnectionButton organizationId={orgId} provider={provider} canCheck={canUpdate} />
                      {canUpdate && canAutoSetup(provider.kind) ? <AutoSetupButton organizationId={orgId} providerId={provider.id} /> : null}
                      {canUpdate ? (
                        <Button variant="outline" size="sm" onClick={() => setProviderDialog({ open: true, provider })}>
                          Edit
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPendingDelete({ type: 'provider', id: provider.id, name: provider.name })}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {canCreate ? (
            <Button className="w-fit" onClick={() => setProviderDialog({ open: true, provider: null })}>
              <PlusIcon className="size-4" />
              Connect provider
            </Button>
          ) : null}
        </div>
      </SettingsSection>

      {providers.length > 0 ? (
        <SettingsSection
          title="Models"
          description="What each model does and costs"
          label="Registered models"
          labelDescription="Prices power every cost figure"
          contentWidth="full"
        >
          <div className="space-y-6">
            {providers.map((provider) => (
              <div key={provider.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{provider.name}</p>
                  <AddModelGate
                    organizationId={orgId}
                    provider={provider}
                    canCheck={canUpdate}
                    onAdd={() => setModelDialog({ provider, model: null })}
                  />
                </div>
                {provider.models.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No models yet.</p>
                ) : (
                  <div className="divide-y rounded-lg border">
                    {provider.models.map((model) => (
                      <div
                        key={model.id}
                        className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between"
                      >
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-medium">{model.displayName}</p>
                            <code className="text-xs text-muted-foreground">{model.modelId}</code>
                            {!model.isEnabled ? <Badge variant="secondary">Disabled</Badge> : null}
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {model.capabilities.map((c) => (
                              <Badge key={c} variant="outline">
                                {AI_CAPABILITY_LABELS[c].label}
                              </Badge>
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {formatPrice(model.inputPricePerMTok)} in / {formatPrice(model.outputPricePerMTok)} out per
                            1M tokens
                            {model.inputPricePerMTok === 0 && model.outputPricePerMTok === 0
                              ? '. Add prices to track cost.'
                              : ''}
                          </p>
                        </div>
                        {canUpdate ? (
                          <div className="flex shrink-0 gap-2">
                            <Button variant="outline" size="sm" onClick={() => setModelDialog({ provider, model })}>
                              Edit
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPendingDelete({ type: 'model', id: model.id, name: model.displayName })}
                            >
                              Remove
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </SettingsSection>
      ) : null}

      {providers.length > 0 ? (
        <SettingsSection
          title="Routing"
          description="Agents ask for a capability; routing decides which model answers"
          label="Capability → model"
          labelDescription="If the primary model fails, the fallback is tried before the task is retried"
          contentWidth="full"
        >
          <RoutingTable organizationId={orgId} providers={providers} routes={routes} canEdit={canUpdate} />
        </SettingsSection>
      ) : null}

      {providers.length > 0 && voiceProfiles.data ? (
        <SettingsSection
          title="Narration voice"
          description="How your course videos sound"
          label="Voice"
          labelDescription="Each voice model keeps its own voice"
          contentWidth="full"
        >
          <NarrationVoiceForm
            organizationId={orgId}
            models={voiceModels}
            fallbackModelId={narrationRoute?.fallbackModelId ?? null}
            profiles={voiceProfiles.data}
            canEdit={canUpdate}
          />
        </SettingsSection>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <ProviderDialog
        organizationId={orgId}
        open={providerDialog.open}
        onOpenChange={(open) => setProviderDialog((d) => ({ ...d, open }))}
        provider={providerDialog.provider}
      />
      {modelDialog ? (
        <ModelDialog
          organizationId={orgId}
          open
          onOpenChange={(open) => !open && setModelDialog(null)}
          provider={modelDialog.provider}
          model={modelDialog.model}
        />
      ) : null}

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete?.type === 'provider'
                ? 'Its stored key, its models, and any routing that uses them are removed. Past cost history is kept.'
                : 'Any routing that uses this model is cleared. Past cost history is kept.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
