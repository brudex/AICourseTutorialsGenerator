'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: ProviderDialog, connect AI provider, edit AI
 *   provider, createAiProviderSchema, updateAiProviderSchema, apiKey
 *
 * WHAT:  One dialog for connecting a new provider and editing an existing
 *        one (name, base URL, key, enabled).
 * WHY:   Create picks the provider kind and pre-fills its base URL from
 *        AI_PROVIDER_PRESETS. Edit never shows the stored key — a blank key
 *        field keeps it, which the update schema and router both honour.
 *        Two forms (not one with optional fields) so each validates against
 *        its own router schema exactly. Both CHECK the credentials with the
 *        provider before saving: a rejected key is refused outright (field
 *        error, nothing saved); other failures (server unreachable, bad URL)
 *        explain why and offer "Save anyway", because a local model server
 *        may simply be switched off right now.
 * WHERE: Opened from AiProvidersSettings.
 */

import * as React from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'

import { ProviderKind } from '@/generated/prisma'
import { trpc } from '@/trpc/react-provider'
import { AI_PROVIDER_PRESETS } from '@/lib/config'
import {
  createAiProviderSchema,
  updateAiProviderSchema,
  type CreateAiProviderValues,
  type UpdateAiProviderValues,
} from '@/lib/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/global/password-input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { AiProviderRow } from './ai-provider-types'

interface ProviderDialogProps {
  organizationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null = connect a new provider. */
  provider: AiProviderRow | null
}

export function ProviderDialog({ organizationId, open, onOpenChange, provider }: ProviderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{provider ? `Edit ${provider.name}` : 'Connect an AI provider'}</DialogTitle>
          <DialogDescription>
            Your API key is encrypted before it is stored and is never shown again.
          </DialogDescription>
        </DialogHeader>
        {/* key remounts the form so it re-seeds when switching providers. */}
        {provider ? (
          <EditProviderForm
            key={provider.id}
            organizationId={organizationId}
            provider={provider}
            onDone={() => onOpenChange(false)}
          />
        ) : (
          <CreateProviderForm key="create" organizationId={organizationId} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

type VerifyOutcome = 'ok' | 'rejected' | 'unverified'

/**
 * SOURCE OF TRUTH KEYWORDS: useCredentialCheck
 *
 * WHAT:  Runs aiProviders.verifyCredentials and maps the result onto the form:
 *        rejected key → apiKey field error; other failure → a form-level
 *        message the user can override with "Save anyway".
 */
function useCredentialCheck() {
  const utils = trpc.useUtils()
  const [checking, setChecking] = React.useState(false)
  const [unverifiedReason, setUnverifiedReason] = React.useState<string | null>(null)

  async function check(
    input: { organizationId: string; providerId: string | null; baseUrl: string; apiKey: string },
    onRejected: (message: string) => void
  ): Promise<VerifyOutcome> {
    setChecking(true)
    setUnverifiedReason(null)
    try {
      const result = await utils.client.aiProviders.verifyCredentials.query(input)
      if (result.ok) return 'ok'
      if (result.errorKind === 'auth') {
        onRejected('The provider rejected this API key.')
        return 'rejected'
      }
      setUnverifiedReason(result.message)
      return 'unverified'
    } catch (err) {
      setUnverifiedReason(err instanceof Error ? err.message : 'Could not check the connection.')
      return 'unverified'
    } finally {
      setChecking(false)
    }
  }

  return { check, checking, unverifiedReason, clearUnverified: () => setUnverifiedReason(null) }
}

function UnverifiedNotice({ reason, onSaveAnyway, saving }: { reason: string; onSaveAnyway: () => void; saving: boolean }) {
  return (
    <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
      <p className="text-destructive">Could not verify the connection: {reason}</p>
      <Button type="button" size="sm" variant="outline" disabled={saving} onClick={onSaveAnyway}>
        Save anyway
      </Button>
    </div>
  )
}

function CreateProviderForm({ organizationId, onDone }: { organizationId: string; onDone: () => void }) {
  const utils = trpc.useUtils()
  const create = trpc.aiProviders.create.useMutation()
  const [error, setError] = React.useState<string | null>(null)
  const credentials = useCredentialCheck()

  const form = useForm<CreateAiProviderValues>({
    resolver: zodResolver(createAiProviderSchema),
    defaultValues: {
      organizationId,
      name: AI_PROVIDER_PRESETS.ALIBABA.label,
      kind: ProviderKind.ALIBABA,
      baseUrl: AI_PROVIDER_PRESETS.ALIBABA.defaultBaseUrl,
      apiKey: '',
    },
  })
  const kind = useWatch({ control: form.control, name: 'kind' })
  const preset = AI_PROVIDER_PRESETS[kind]

  /* Switching kind re-seeds name + URL, but only while the user hasn't
   * customised them away from the previous kind's defaults. */
  function onKindChange(next: ProviderKind) {
    const previous = AI_PROVIDER_PRESETS[form.getValues('kind')]
    if (form.getValues('name') === previous.label) form.setValue('name', AI_PROVIDER_PRESETS[next].label)
    if (form.getValues('baseUrl') === previous.defaultBaseUrl) {
      form.setValue('baseUrl', AI_PROVIDER_PRESETS[next].defaultBaseUrl)
    }
    form.setValue('kind', next, { shouldValidate: true })
  }

  async function save(values: CreateAiProviderValues) {
    setError(null)
    try {
      await create.mutateAsync(values)
      await Promise.all([
        utils.aiProviders.list.invalidate({ organizationId }),
        utils.aiProviders.testConnection.invalidate(),
      ])
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect this provider.')
    }
  }

  async function onSubmit(values: CreateAiProviderValues) {
    const outcome = await credentials.check(
      { organizationId, providerId: null, baseUrl: values.baseUrl, apiKey: values.apiKey },
      (message) => form.setError('apiKey', { message })
    )
    if (outcome === 'ok') await save(values)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <FormField
          control={form.control}
          name="kind"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Provider</FormLabel>
              <Select value={field.value} onValueChange={(value) => value && onKindChange(value)}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(value: ProviderKind) => AI_PROVIDER_PRESETS[value].label}</SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {Object.values(ProviderKind).map((k) => (
                    <SelectItem key={k} value={k}>
                      {AI_PROVIDER_PRESETS[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>{preset.description}</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Connection name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="baseUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Base URL</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              {preset.alternateBaseUrls.length > 0 ? (
                <FormDescription>Also available: {preset.alternateBaseUrls.join(', ')}</FormDescription>
              ) : null}
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="apiKey"
          render={({ field }) => (
            <FormItem>
              <FormLabel>API key{preset.apiKeyRequired ? '' : ' (optional)'}</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="off" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {credentials.unverifiedReason ? (
          <UnverifiedNotice
            reason={credentials.unverifiedReason}
            saving={create.isPending}
            onSaveAnyway={() => void save(form.getValues())}
          />
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending || credentials.checking}>
            {create.isPending || credentials.checking ? <Loader2Icon className="size-4 animate-spin" /> : null}
            {credentials.checking ? 'Checking key…' : 'Connect'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}

function EditProviderForm({
  organizationId,
  provider,
  onDone,
}: {
  organizationId: string
  provider: AiProviderRow
  onDone: () => void
}) {
  const utils = trpc.useUtils()
  const update = trpc.aiProviders.update.useMutation()
  const [error, setError] = React.useState<string | null>(null)
  const credentials = useCredentialCheck()

  const form = useForm<UpdateAiProviderValues>({
    resolver: zodResolver(updateAiProviderSchema),
    defaultValues: {
      organizationId,
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiKey: '',
      isEnabled: provider.isEnabled,
    },
  })

  async function save(values: UpdateAiProviderValues) {
    setError(null)
    try {
      await update.mutateAsync(values)
      await Promise.all([
        utils.aiProviders.list.invalidate({ organizationId }),
        utils.aiProviders.testConnection.invalidate(),
      ])
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this provider.')
    }
  }

  /* Re-check only when what reaches the provider changed (key or URL). */
  async function onSubmit(values: UpdateAiProviderValues) {
    const changed = values.apiKey.length > 0 || values.baseUrl !== provider.baseUrl
    if (!changed || !values.isEnabled) return save(values)
    const outcome = await credentials.check(
      { organizationId, providerId: provider.id, baseUrl: values.baseUrl, apiKey: values.apiKey },
      (message) => form.setError('apiKey', { message })
    )
    if (outcome === 'ok') await save(values)
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Connection name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="baseUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Base URL</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="apiKey"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Replace API key</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="off" placeholder="Leave blank to keep the current key" {...field} />
              </FormControl>
              {provider.apiKeyLast4 ? (
                <FormDescription>Current key ends in ••••{provider.apiKeyLast4}</FormDescription>
              ) : null}
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="isEnabled"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between gap-4">
              <div className="space-y-1">
                <FormLabel>Enabled</FormLabel>
                <FormDescription>Disabled providers are skipped by routing.</FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        {credentials.unverifiedReason ? (
          <UnverifiedNotice
            reason={credentials.unverifiedReason}
            saving={update.isPending}
            onSaveAnyway={() => void save(form.getValues())}
          />
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={update.isPending || credentials.checking}>
            {update.isPending || credentials.checking ? <Loader2Icon className="size-4 animate-spin" /> : null}
            {credentials.checking ? 'Checking key…' : 'Save'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
