'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: ModelDialog, register AI model, edit AI model,
 *   upsertAiModelSchema, model capabilities, model pricing, ModelIdPicker
 *
 * WHAT:  Add or edit a model on a provider: id, name, capabilities, prices,
 *        JSON-schema support, context window, enabled, and for Narration
 *        models the voice ids the model speaks with (ModelVoicesField).
 * WHY:   The model-id field suggests (a) the provider kind's starter models
 *        and (b) every id the provider lists for this key (loaded on open),
 *        in a searchable picker, so users pick real ids
 *        instead of guessing. Choosing a starter model pre-fills its name,
 *        capabilities, and JSON-schema flag. Prices are always typed in by the
 *        user (see AI_PROVIDER_PRESETS for why we never guess them).
 * WHERE: Opened from AiProvidersSettings.
 */

import * as React from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'

import { AiCapability } from '@/generated/prisma'
import { trpc } from '@/trpc/react-provider'
import { AI_CAPABILITY_LABELS, AI_PROVIDER_PRESETS, modelVoicesFor } from '@/lib/config'
import { upsertAiModelSchema, type UpsertAiModelValues } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { ModelIdPicker } from './model-id-picker'
import type { AiModelRow, AiProviderRow } from './ai-provider-types'

interface ModelDialogProps {
  organizationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  provider: AiProviderRow
  /** null = add a new model. */
  model: AiModelRow | null
}

export function ModelDialog(props: ModelDialogProps) {
  const { open, onOpenChange, provider, model } = props
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{model ? `Edit ${model.displayName}` : `Add a model to ${provider.name}`}</DialogTitle>
          <DialogDescription>
            Capabilities decide which agents can use this model. Prices drive cost tracking.
          </DialogDescription>
        </DialogHeader>
        <ModelForm key={model?.id ?? `new-${provider.id}`} {...props} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

/* Empty number inputs become NaN, which the schema rejects with a message. */
function toNumber(event: React.ChangeEvent<HTMLInputElement>): number {
  return event.target.valueAsNumber
}

function ModelForm({
  organizationId,
  provider,
  model,
  onDone,
}: ModelDialogProps & { onDone: () => void }) {
  const utils = trpc.useUtils()
  const upsert = trpc.aiProviders.upsertModel.useMutation()
  const [error, setError] = React.useState<string | null>(null)
  const suggestions = AI_PROVIDER_PRESETS[provider.kind].suggestedModels
  /* Voice only providers (ElevenLabs) offer just the capabilities they serve. */
  const capabilityChoices = AI_PROVIDER_PRESETS[provider.kind].allowedCapabilities ?? Object.values(AiCapability)
  /* The provider's own model list (GET /models), loaded when the dialog
   * opens so users pick real ids. Cached for 5 minutes per provider. */
  const available = trpc.aiProviders.testConnection.useQuery(
    { organizationId, id: provider.id },
    { staleTime: 5 * 60_000, retry: false }
  )
  const availableIds = available.data?.ok ? available.data.modelIds : []
  const availableError = available.data && !available.data.ok ? available.data.message : (available.error?.message ?? null)

  const form = useForm<UpsertAiModelValues>({
    resolver: zodResolver(upsertAiModelSchema),
    defaultValues: model
      ? {
          organizationId,
          id: model.id,
          providerId: provider.id,
          modelId: model.modelId,
          displayName: model.displayName,
          capabilities: model.capabilities,
          inputPricePerMTok: model.inputPricePerMTok,
          outputPricePerMTok: model.outputPricePerMTok,
          supportsJsonSchema: model.supportsJsonSchema,
          contextWindow: model.contextWindow,
          /* What the model speaks with today: its saved voices, else its starter list. */
          voices: model.capabilities.includes(AiCapability.TTS)
            ? modelVoicesFor(provider.kind, model.modelId, model.voices).voices.map((v) => v.id)
            : [],
          isEnabled: model.isEnabled,
        }
      : {
          organizationId,
          id: null,
          providerId: provider.id,
          modelId: '',
          displayName: '',
          capabilities: [capabilityChoices.includes(AiCapability.STRONG_REASONING) ? AiCapability.STRONG_REASONING : (capabilityChoices[0] ?? AiCapability.STRONG_REASONING)],
          inputPricePerMTok: 0,
          outputPricePerMTok: 0,
          supportsJsonSchema: false,
          contextWindow: null,
          voices: [],
          isEnabled: true,
        },
  })

  const capabilities = useWatch({ control: form.control, name: 'capabilities' })
  const modelId = useWatch({ control: form.control, name: 'modelId' })
  const isSpeech = capabilities.includes(AiCapability.TTS)
  /* The model family's starter voices, offered to fill an empty list. */
  const starterVoices = modelId ? modelVoicesFor(provider.kind, modelId, []).voices.map((v) => v.id) : []
  /* Image models are priced per picture: the input price field holds it. */
  const isImage = capabilities.includes(AiCapability.IMAGE_GENERATION)

  /* Picking a starter model fills in what we know about it. */
  function onModelIdChange(value: string) {
    form.setValue('modelId', value, { shouldValidate: form.formState.isSubmitted })
    const suggestion = suggestions.find((s) => s.modelId === value)
    if (model) return
    if (!suggestion) {
      if (!form.getValues('displayName')) form.setValue('displayName', value)
      return
    }
    form.setValue('displayName', suggestion.displayName)
    form.setValue('capabilities', [...suggestion.capabilities])
    form.setValue('supportsJsonSchema', suggestion.supportsJsonSchema)
    /* A starter voice model comes with its family's voices, ready to edit. */
    if (suggestion.capabilities.includes(AiCapability.TTS) && form.getValues('voices').length === 0) {
      form.setValue('voices', modelVoicesFor(provider.kind, value, []).voices.map((v) => v.id))
    }
  }

  async function onSubmit(values: UpsertAiModelValues) {
    setError(null)
    try {
      await upsert.mutateAsync(values)
      await Promise.all([
        utils.aiProviders.list.invalidate({ organizationId }),
        utils.aiProviders.listVoices.invalidate({ organizationId }),
      ])
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this model.')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <FormField
          control={form.control}
          name="modelId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Model id</FormLabel>
              <ModelIdPicker
                value={field.value}
                onChange={onModelIdChange}
                suggestions={suggestions}
                available={availableIds}
                loading={available.isLoading}
                loadError={availableError}
                disabled={model !== null}
              />
              {model ? <FormDescription>The model id cannot change. Add a new model instead.</FormDescription> : null}
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="displayName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Display name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="capabilities"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Capabilities</FormLabel>
              <div className="grid gap-2 sm:grid-cols-2">
                {capabilityChoices.map((capability) => {
                  const checked = field.value.includes(capability)
                  return (
                    <label key={capability} className="flex items-start gap-2 rounded-md border p-2 text-sm">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(next) =>
                          field.onChange(
                            next ? [...field.value, capability] : field.value.filter((c) => c !== capability)
                          )
                        }
                      />
                      <span className="space-y-0.5">
                        <span className="block font-medium">{AI_CAPABILITY_LABELS[capability].label}</span>
                        <span className="block text-xs text-muted-foreground">
                          {AI_CAPABILITY_LABELS[capability].description}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="inputPricePerMTok"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Input price</FormLabel>
                <FormControl>
                  <Input type="number" step="0.0001" min={0} {...field} onChange={(e) => field.onChange(toNumber(e))} />
                </FormControl>
                <FormDescription>{isImage ? 'USD per image' : isSpeech ? 'USD per 1M characters' : 'USD per 1M tokens'}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="outputPricePerMTok"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Output price</FormLabel>
                <FormControl>
                  <Input type="number" step="0.0001" min={0} {...field} onChange={(e) => field.onChange(toNumber(e))} />
                </FormControl>
                <FormDescription>{isImage ? 'Not used for images' : isSpeech ? 'Not used for speech' : 'USD per 1M tokens'}</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        {AI_PROVIDER_PRESETS[provider.kind].pricingUrl ? (
          <p className="-mt-2 text-xs text-muted-foreground">
            Check current prices on the{' '}
            <a
              href={AI_PROVIDER_PRESETS[provider.kind].pricingUrl ?? undefined}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              provider’s pricing page
            </a>
            .
          </p>
        ) : null}
        <FormField
          control={form.control}
          name="contextWindow"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Context window (optional)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1000}
                  step={1000}
                  placeholder="e.g. 128000"
                  name={field.name}
                  ref={field.ref}
                  onBlur={field.onBlur}
                  value={field.value ?? ''}
                  onChange={(e) => field.onChange(e.target.value === '' ? null : toNumber(e))}
                />
              </FormControl>
              <FormDescription>Tokens. Used later to pick models for long source material.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {isSpeech ? (
          <FormField
            control={form.control}
            name="voices"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Voices</FormLabel>
                <ModelVoicesField value={field.value} onChange={field.onChange} starter={starterVoices} />
                <FormDescription>
                  One voice id per line, exactly as the provider names it. The first is the default.
                  Voices the provider lists live are added automatically.
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        <FormField
          control={form.control}
          name="supportsJsonSchema"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between gap-4">
              <div className="space-y-1">
                <FormLabel>Supports JSON schema output</FormLabel>
                <FormDescription>
                  Turn on only if the provider documents <code>response_format: json_schema</code> for this model.
                  Off is always safe.
                </FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
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
                <FormDescription>Disabled models are skipped by routing.</FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={upsert.isPending}>
            {upsert.isPending ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Save model
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: ModelVoicesField, model voice list editor,
 *   AiModel.voices, voice ids per line, starter voices, Narration model voices
 *
 * WHAT:  Edits a Narration model's voice ids as one id per line, with a button
 *        that fills an empty list with the model family's starter voices.
 * WHY:   Voices are workspace data on the model, so adding a provider's new
 *        voice is a model edit. The text is kept locally while typing so a
 *        new empty line is not swallowed; the form gets the trimmed ids.
 * WHERE: ModelDialog, shown when the Narration capability is ticked.
 */
function ModelVoicesField({
  value,
  onChange,
  starter,
}: {
  value: string[]
  onChange: (voices: string[]) => void
  starter: readonly string[]
}) {
  const [text, setText] = React.useState(value.join('\n'))
  /* Outside changes (a starter model picked) replace what is shown. */
  const [synced, setSynced] = React.useState(value)
  if (value.join('\n') !== synced.join('\n')) {
    setSynced(value)
    setText(value.join('\n'))
  }

  function update(next: string) {
    const voices = next.split('\n').map((line) => line.trim()).filter(Boolean)
    setText(next)
    setSynced(voices)
    onChange(voices)
  }

  return (
    <div className="space-y-2">
      <FormControl>
        <Textarea rows={5} value={text} onChange={(e) => update(e.target.value)} placeholder="e.g. Cherry" className="font-mono text-sm" />
      </FormControl>
      {value.length === 0 && starter.length > 0 ? (
        <Button type="button" size="sm" variant="outline" onClick={() => update(starter.join('\n'))}>
          Add starter voices
        </Button>
      ) : null}
    </div>
  )
}
