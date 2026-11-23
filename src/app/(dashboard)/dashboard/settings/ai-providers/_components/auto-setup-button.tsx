'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: AutoSetupButton, useAutoSetup, canAutoSetup, set
 *   up for me, one click AI setup, recommended models, aiProviders.autoSetup
 *
 * WHAT:  "Set up for me": adds a provider's recommended models that its key
 *        offers and points every job (writing, fast text, coding, narration,
 *        vision, pictures) at them, then says what it did.
 * WHY:   People who are not technical should not need to know model names or
 *        routing. The connect dialog runs it right after connecting (with the
 *        model list it just checked); the provider row button runs it later,
 *        reading the model list first. A failed connection check stops it, so
 *        nothing unusable is added. Running it again is safe (models already
 *        there are kept).
 * WHERE: ProviderDialog (connect), provider rows in AiProvidersSettings.
 */

import * as React from 'react'
import { Loader2Icon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'

import type { ProviderKind } from '@/generated/prisma'
import { trpc } from '@/trpc/react-provider'
import { AI_CAPABILITY_LABELS, planAutoSetup } from '@/lib/config'
import { Button } from '@/components/ui/button'

/* Whether this kind of provider has recommended models to set up. */
export function canAutoSetup(kind: ProviderKind): boolean {
  return planAutoSetup(kind, []).models.length > 0
}

export function useAutoSetup(organizationId: string) {
  const utils = trpc.useUtils()
  const autoSetup = trpc.aiProviders.autoSetup.useMutation()
  const [running, setRunning] = React.useState(false)

  /* availableModelIds: the list a connection check just returned; read it when absent. */
  async function run(providerId: string, availableModelIds?: readonly string[]): Promise<boolean> {
    setRunning(true)
    try {
      let ids = availableModelIds
      if (!ids) {
        const check = await utils.client.aiProviders.testConnection.query({ organizationId, id: providerId })
        if (!check.ok) {
          toast.error(`Could not reach this provider: ${check.message}`)
          return false
        }
        ids = check.modelIds
      }
      const result = await autoSetup.mutateAsync({ organizationId, providerId, availableModelIds: [...ids] })
      await Promise.all([
        utils.aiProviders.list.invalidate({ organizationId }),
        utils.aiProviders.listVoices.invalidate({ organizationId }),
        utils.dashboard.setup.invalidate({ organizationId }),
      ])
      const jobs = result.routed.map((capability) => AI_CAPABILITY_LABELS[capability].label).join(', ')
      toast.success(
        result.added > 0
          ? `Set up ${result.added} recommended ${result.added === 1 ? 'model' : 'models'} for ${jobs}. Add prices to track costs.`
          : `Your models now cover ${jobs}.`
      )
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not set up the models.')
      return false
    } finally {
      setRunning(false)
    }
  }

  return { run, running }
}

export function AutoSetupButton({ organizationId, providerId }: { organizationId: string; providerId: string }) {
  const { run, running } = useAutoSetup(organizationId)
  return (
    <Button variant="outline" size="sm" disabled={running} onClick={() => void run(providerId)}>
      {running ? <Loader2Icon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
      Set up for me
    </Button>
  )
}
