'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: RoutingTable, capability routing UI,
 *   setCapabilityRoute, applyRoutingPreset, primary model, fallback model
 *
 * WHAT:  One row per capability with a primary and fallback model picker,
 *        plus the Economy / Balanced / Best quality preset buttons.
 * WHY:   Agents request capabilities, so this table IS the model assignment
 *        for the whole agent team. Each change saves immediately (no form
 *        submit) because each row is an independent route. Each row only
 *        offers models tagged with that capability (a voice model can never
 *        be picked to write quizzes), and the fallback picker excludes the
 *        chosen primary; the router enforces both.
 * WHERE: Rendered in the Routing section of AiProvidersSettings.
 */

import * as React from 'react'
import { Loader2Icon } from 'lucide-react'

import { AiCapability } from '@/generated/prisma'
import { trpc } from '@/trpc/react-provider'
import { AI_CAPABILITY_LABELS, ROUTING_PRESET_LABELS } from '@/lib/config'
import { ROUTING_PRESETS, type RoutingPreset } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { AiProviderRow, CapabilityRouteRow } from './ai-provider-types'

/* Select sentinel for "no fallback" — Base UI cannot hold an empty value. */
const NO_FALLBACK = 'none'

interface RoutingTableProps {
  organizationId: string
  providers: readonly AiProviderRow[]
  routes: readonly CapabilityRouteRow[]
  canEdit: boolean
}

export function RoutingTable({ organizationId, providers, routes, canEdit }: RoutingTableProps) {
  const utils = trpc.useUtils()
  const setRoute = trpc.aiProviders.setRoute.useMutation()
  const applyPreset = trpc.aiProviders.applyPreset.useMutation()
  const [error, setError] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState<string | null>(null)

  /* Only enabled models on enabled providers can be routed. */
  const models = providers.flatMap((p) =>
    p.isEnabled ? p.models.filter((m) => m.isEnabled).map((m) => ({ ...m, providerName: p.name })) : []
  )
  const modelLabel = (id: string) => {
    const m = models.find((x) => x.id === id)
    return m ? `${m.displayName} · ${m.providerName}` : 'Unavailable model'
  }

  async function run(action: () => Promise<unknown>, success: string | null) {
    setError(null)
    setMessage(null)
    try {
      await action()
      await Promise.all([
        utils.aiProviders.list.invalidate({ organizationId }),
        utils.aiProviders.listVoices.invalidate({ organizationId }),
      ])
      setMessage(success)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update routing.')
    }
  }

  function onPreset(preset: RoutingPreset) {
    void run(
      () => applyPreset.mutateAsync({ organizationId, preset }),
      `${ROUTING_PRESET_LABELS[preset].label} preset applied.`
    )
  }

  function onChange(capability: AiCapability, modelId: string, fallbackModelId: string | null) {
    void run(() => setRoute.mutateAsync({ organizationId, capability, modelId, fallbackModelId }), null)
  }

  if (models.length === 0) {
    return <p className="text-sm text-muted-foreground">Add an enabled model to set up routing.</p>
  }

  return (
    <div className="space-y-6">
      {canEdit ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Presets</p>
          <div className="flex flex-wrap gap-2">
            {ROUTING_PRESETS.map((preset) => (
              <Button
                key={preset}
                variant="outline"
                size="sm"
                disabled={applyPreset.isPending}
                onClick={() => onPreset(preset)}
                title={ROUTING_PRESET_LABELS[preset].description}
              >
                {applyPreset.isPending && applyPreset.variables.preset === preset ? (
                  <Loader2Icon className="size-4 animate-spin" />
                ) : null}
                {ROUTING_PRESET_LABELS[preset].label}
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Presets rank models by the prices you entered and replace the whole table.
          </p>
        </div>
      ) : null}

      <div className="divide-y rounded-lg border">
        {Object.values(AiCapability).map((capability) => {
          const route = routes.find((r) => r.capability === capability)
          const options = models.filter((m) => m.capabilities.includes(capability))
          const fallbackOptions = options.filter((m) => m.id !== route?.modelId)
          return (
            <div key={capability} className="grid gap-3 p-4 md:grid-cols-[1fr_220px_220px] md:items-center">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">{AI_CAPABILITY_LABELS[capability].label}</p>
                <p className="text-xs text-muted-foreground">{AI_CAPABILITY_LABELS[capability].description}</p>
              </div>
              <Select
                value={route?.modelId ?? null}
                disabled={!canEdit || setRoute.isPending}
                onValueChange={(value) =>
                  value &&
                  onChange(capability, value, route?.fallbackModelId === value ? null : (route?.fallbackModelId ?? null))
                }
              >
                <SelectTrigger className="w-full" aria-label={`Primary model for ${AI_CAPABILITY_LABELS[capability].label}`}>
                  <SelectValue>{(value: string | null) => (value ? modelLabel(value) : 'Not set')}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {options.length === 0 ? (
                    <p className="px-2 py-1.5 text-sm text-muted-foreground">No model has this capability yet</p>
                  ) : null}
                  {options.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName} · {m.providerName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={route?.fallbackModelId ?? NO_FALLBACK}
                disabled={!canEdit || !route || setRoute.isPending}
                onValueChange={(value) =>
                  route && onChange(capability, route.modelId, !value || value === NO_FALLBACK ? null : value)
                }
              >
                <SelectTrigger className="w-full" aria-label={`Fallback model for ${AI_CAPABILITY_LABELS[capability].label}`}>
                  <SelectValue>
                    {(value: string | null) => (!value || value === NO_FALLBACK ? 'No fallback' : modelLabel(value))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_FALLBACK}>No fallback</SelectItem>
                  {fallbackOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.displayName} · {m.providerName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        })}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
    </div>
  )
}
