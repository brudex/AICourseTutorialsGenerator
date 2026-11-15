/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: PlatformSettings, PlatformSettingsGroupForm,
 *   PlatformSettingInput, portal settings form, operator settings UI,
 *   platformSettingsGroupFormSchema, portal.updateSettings
 *
 * WHAT:  The /portal/settings editor: one form per PLATFORM_SETTING_GROUPS
 *        group, each field rendered from its registry kind (text, secret,
 *        switch, number, choice, JSON).
 * WHY:   Fully registry driven, so a new setting in the registry shows up
 *        here with its validation and no UI change. Each group saves on its
 *        own (RHF + the generated group schema). Secrets are never shown: a
 *        blank secret keeps the saved value, Remove clears it. Saving a group
 *        also stores values that were coming from the server file, which moves
 *        them into the database.
 * WHERE: Rendered by src/app/(portal)/portal/settings/page.tsx.
 */

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { trpc } from '@/trpc/react-provider'
import { PLATFORM_SETTING_GROUPS } from '@/lib/config/platform-settings'
import {
  platformSettingsGroupFormSchema,
  type PlatformSettingFieldDefinition,
  type PlatformSettingGroupDefinition,
  type PlatformSettingState,
  type PlatformSettingsView,
} from '@/lib/types'
import { SettingsSection } from '@/components/global/settings-section'
import { PasswordInput } from '@/components/global/password-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

type GroupFormValues = Record<string, string>

export function PlatformSettings() {
  const { data, isLoading } = trpc.portal.getSettings.useQuery()

  if (isLoading || !data) return <Skeleton className="h-96 w-full" />

  return (
    <div className="space-y-10">
      {PLATFORM_SETTING_GROUPS.map((group) => (
        <PlatformSettingsGroupForm key={group.id} group={group} view={data} />
      ))}
    </div>
  )
}

/* Secrets start blank (never sent to the browser); everything else shows the
 * value in force, so saving the group stores it here. */
function formValuesFor(group: PlatformSettingGroupDefinition, states: ReadonlyMap<string, PlatformSettingState>) {
  return Object.fromEntries(
    group.fields.map((field) => [field.key, field.secret ? '' : (states.get(field.key)?.value ?? field.defaultValue)])
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: PlatformSettingsGroupForm
 *
 * WHAT:  One settings group as a form with its own Save button.
 * WHERE: PlatformSettings.
 */
function PlatformSettingsGroupForm({
  group,
  view,
}: {
  group: PlatformSettingGroupDefinition
  view: PlatformSettingsView
}) {
  const utils = trpc.useUtils()
  const update = trpc.portal.updateSettings.useMutation()
  const states = React.useMemo(() => new Map<string, PlatformSettingState>(view.map((state) => [state.key, state])), [view])
  const schema = React.useMemo(() => platformSettingsGroupFormSchema(group), [group])
  const [clear, setClear] = React.useState<ReadonlySet<string>>(new Set())

  const form = useForm<GroupFormValues>({
    resolver: zodResolver(schema),
    defaultValues: formValuesFor(group, states),
  })

  /* Re-seed after a save refetches the view. */
  React.useEffect(() => {
    form.reset(formValuesFor(group, states))
  }, [form, group, states])

  async function onSubmit(values: GroupFormValues) {
    try {
      await update.mutateAsync({ groupId: group.id, values, clear: [...clear] })
      setClear(new Set())
      await utils.portal.getSettings.invalidate()
      toast.success(`${group.label} saved`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save settings.')
    }
  }

  function toggleClear(key: string) {
    setClear((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <SettingsSection title={group.label} label={group.label} labelDescription={group.description}>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
          {group.fields.map((definition) => (
            <FormField
              key={definition.key}
              control={form.control}
              name={definition.key}
              render={({ field }) => (
                <PlatformSettingInput
                  definition={definition}
                  state={states.get(definition.key)}
                  value={field.value ?? ''}
                  onChange={field.onChange}
                  markedForRemoval={clear.has(definition.key)}
                  onToggleRemove={() => toggleClear(definition.key)}
                />
              )}
            />
          ))}
          <Button type="submit" className="w-fit" disabled={update.isPending}>
            {update.isPending ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Save {group.label.toLowerCase()}
          </Button>
        </form>
      </Form>
    </SettingsSection>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: PlatformSettingInput, PlatformSettingSourceBadge
 *
 * WHAT:  The control for one setting, chosen by its registry kind, with a
 *        badge saying where the value in force comes from.
 * WHERE: PlatformSettingsGroupForm.
 */
function PlatformSettingInput({
  definition,
  state,
  value,
  onChange,
  markedForRemoval,
  onToggleRemove,
}: {
  definition: PlatformSettingFieldDefinition
  state: PlatformSettingState | undefined
  value: string
  onChange: (value: string) => void
  markedForRemoval: boolean
  onToggleRemove: () => void
}) {
  const label = (
    <div className="flex flex-wrap items-center gap-2">
      <FormLabel>{definition.label}</FormLabel>
      {state?.source === 'server' ? <Badge variant="outline">From server file</Badge> : null}
      {definition.secret && state?.hasValue ? (
        <Badge variant="secondary">{markedForRemoval ? 'Will be removed' : `Ends in ${state.last4}`}</Badge>
      ) : null}
    </div>
  )

  if (definition.kind === 'boolean') {
    return (
      <FormItem className="flex flex-row items-center justify-between gap-4">
        <div className="space-y-1">
          {label}
          <FormDescription>{definition.help}</FormDescription>
        </div>
        <FormControl>
          <Switch checked={value === 'true'} onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')} />
        </FormControl>
      </FormItem>
    )
  }

  return (
    <FormItem>
      {label}
      <FormControl>
        {definition.kind === 'select' ? (
          <Select value={value} onValueChange={(next) => next && onChange(next)}>
            <SelectTrigger className="w-full">
              <SelectValue>
                {(selected: string) => definition.options?.find((option) => option.value === selected)?.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {definition.options?.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : definition.kind === 'json' ? (
          <Textarea
            rows={4}
            className="font-mono text-xs"
            autoComplete="off"
            placeholder={definition.secret && state?.hasValue ? 'Saved. Paste new JSON to replace it.' : '{}'}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : definition.secret ? (
          <PasswordInput
            autoComplete="off"
            placeholder={state?.hasValue ? 'Saved. Type a new value to replace it.' : definition.placeholder}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        ) : (
          <Input
            inputMode={definition.kind === 'number' ? 'numeric' : undefined}
            placeholder={definition.placeholder ?? definition.defaultValue}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
        )}
      </FormControl>
      <FormDescription>{definition.help}</FormDescription>
      {definition.secret && state?.source === 'saved' ? (
        <Button type="button" variant="link" size="sm" className="h-auto w-fit p-0" onClick={onToggleRemove}>
          {markedForRemoval ? 'Keep saved value' : 'Remove saved value'}
        </Button>
      ) : null}
      <FormMessage />
    </FormItem>
  )
}
