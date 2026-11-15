'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: useProviderStatus, ProviderStatusLine,
 *   TestConnectionButton, AddModelGate, connection health
 *
 * WHAT:  Live connection health for one provider and the controls that
 *        depend on it: a status line (Connected / Key rejected / …), the Test
 *        connection button (re-checks), and the Add model gate.
 * WHY:   One cached query per provider (aiProviders.testConnection, 5 min) is
 *        shared by every piece — React Query dedupes identical keys — and by
 *        the model dialog's model list. Models can only be added to a working
 *        connection: adding models to a provider that rejects its key just
 *        produces failing jobs later. Disabled providers are not checked.
 * WHERE: AiProvidersSettings (connections + models sections).
 */

import { CheckCircle2Icon, Loader2Icon, PlusIcon, XCircleIcon } from 'lucide-react'

import { trpc } from '@/trpc/react-provider'
import { Button } from '@/components/ui/button'
import type { AiProviderRow } from './ai-provider-types'

export function useProviderStatus(organizationId: string, provider: AiProviderRow, canCheck: boolean) {
  return trpc.aiProviders.testConnection.useQuery(
    { organizationId, id: provider.id },
    { enabled: canCheck && provider.isEnabled, staleTime: 5 * 60_000, retry: false }
  )
}

interface StatusProps {
  organizationId: string
  provider: AiProviderRow
  canCheck: boolean
}

export function ProviderStatusLine({ organizationId, provider, canCheck }: StatusProps) {
  const status = useProviderStatus(organizationId, provider, canCheck)
  if (!provider.isEnabled || !canCheck) return null
  if (status.isFetching && !status.data) {
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin" /> Checking connection…
      </p>
    )
  }
  const data = status.data
  if (data?.ok) {
    return (
      <p className="flex items-center gap-1 text-xs text-success">
        <CheckCircle2Icon className="size-3" /> Connected · {data.modelIds.length} models available
      </p>
    )
  }
  const message = data && !data.ok ? data.message : (status.error?.message ?? null)
  return message ? (
    <p className="flex items-center gap-1 text-xs text-destructive">
      <XCircleIcon className="size-3" /> {message}
    </p>
  ) : null
}

export function TestConnectionButton({ organizationId, provider, canCheck }: StatusProps) {
  const status = useProviderStatus(organizationId, provider, canCheck)
  if (!canCheck || !provider.isEnabled) return null
  return (
    <Button variant="outline" size="sm" disabled={status.isFetching} onClick={() => void status.refetch()}>
      {status.isFetching ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
      Test connection
    </Button>
  )
}

export function AddModelGate({ organizationId, provider, canCheck, onAdd }: StatusProps & { onAdd: () => void }) {
  const status = useProviderStatus(organizationId, provider, canCheck)
  if (!canCheck) return null
  if (!provider.isEnabled) return <span className="text-xs text-muted-foreground">Enable the provider to add models</span>
  if (status.data?.ok) {
    return (
      <Button variant="outline" size="sm" onClick={onAdd}>
        <PlusIcon className="size-4" />
        Add model
      </Button>
    )
  }
  if (status.isFetching) return <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
  return <span className="text-xs text-destructive">Fix the connection to add models</span>
}
