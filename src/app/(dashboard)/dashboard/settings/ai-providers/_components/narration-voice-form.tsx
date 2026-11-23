'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: NarrationVoiceForm, ModelVoicePanel,
 *   VoiceProfileForm, narration voice settings, voice model picker, preview
 *   voice, VoiceProfile form, aiProviders.listVoices, voice per model
 *
 * WHAT:  Picks a voice model, loads that model's voices (live from its
 *        provider when it can list them, else the model's own saved voice
 *        list; a typed voice id joins that list on save) and saves a
 *        voice, speed and speaking style for it. A model that is not the
 *        Narration model can be made the Narration model from here.
 * WHY:   Voice ids only work on their own model, so every voice model keeps
 *        its own voice: rerouting Narration or falling back never sends a
 *        model a voice it does not have. Voice is chosen by ear, so Preview
 *        plays the unsaved choice on the chosen model before saving. Only
 *        the controls the model honours are shown.
 * WHERE: Narration voice section of AiProvidersSettings.
 */

import * as React from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon, PlayIcon } from 'lucide-react'

import { AiCapability } from '@/generated/prisma'
import { trpc } from '@/trpc/react-provider'
import { resolveVoiceForModel } from '@/lib/config'
import {
  saveVoiceProfileSchema,
  type NarrationModelChoice,
  type NarrationRouteRole,
  type NarrationVoiceModel,
  type SavedNarrationVoice,
  type SaveVoiceProfileValues,
  type VoiceCatalogSource,
  type VoiceNoticeTone,
} from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

const SPEEDS = [0.75, 0.9, 1, 1.1, 1.2, 1.25, 1.5] as const

const ROLE_LABELS: Record<NarrationRouteRole, string> = { primary: 'Narration', fallback: 'Fallback' }

/* Info notes are calm (nothing is broken); warnings stand out. */
const NOTICE_TONE_CLASS: Record<VoiceNoticeTone, string> = {
  info: 'text-muted-foreground',
  warning: 'border-destructive/40 text-destructive',
}

/* Where the listed voices came from; edit a model's own voices in its model dialog. */
const VOICE_SOURCE_COPY: Record<VoiceCatalogSource, (m: NarrationVoiceModel) => string> = {
  live: (m) => `Voices loaded from ${m.providerName}.`,
  model: (m) => `Voices saved on ${m.displayName}. Edit the model to change the list.`,
  catalog: (m) => `Popular voices for ${m.displayName}. Edit the model to set its own list.`,
}

interface NarrationVoiceFormProps {
  organizationId: string
  /* Enabled models tagged for Narration, with their place in the route. */
  models: readonly NarrationModelChoice[]
  fallbackModelId: string | null
  profiles: readonly SavedNarrationVoice[]
  canEdit: boolean
}

export function NarrationVoiceForm({ organizationId, models, fallbackModelId, profiles, canEdit }: NarrationVoiceFormProps) {
  const utils = trpc.useUtils()
  const setRoute = trpc.aiProviders.setRoute.useMutation()
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [routeError, setRouteError] = React.useState<string | null>(null)
  const primary = models.find((m) => m.role === 'primary') ?? null
  /* The chosen model, else the Narration model, else the first voice model. */
  const selected = models.find((m) => m.id === selectedId) ?? primary ?? models[0] ?? null

  if (!selected) {
    return (
      <p className="text-sm text-muted-foreground">
        Add a model with the Narration capability to a provider above to pick its voice.
      </p>
    )
  }

  /* Makes the chosen model the Narration model; a promoted fallback swaps places with the old one. */
  async function routeToNarration(model: NarrationModelChoice) {
    setRouteError(null)
    const nextFallback = model.role === 'fallback' ? (primary?.id ?? null) : fallbackModelId === model.id ? null : fallbackModelId
    try {
      await setRoute.mutateAsync({ organizationId, capability: AiCapability.TTS, modelId: model.id, fallbackModelId: nextFallback })
      await utils.aiProviders.list.invalidate({ organizationId })
    } catch (err) {
      setRouteError(err instanceof Error ? err.message : 'Could not change the Narration model.')
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-5">
      <div className="space-y-2">
        <p className="text-sm font-medium">Voice model</p>
        <Select value={selected.id} onValueChange={(value) => value && setSelectedId(value)}>
          <SelectTrigger className="w-full" aria-label="Voice model">
            <SelectValue>
              {(value: string) => {
                const model = models.find((m) => m.id === value)
                return model ? `${model.displayName} · ${model.providerName}` : 'Choose a model'
              }}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {models.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.displayName} · {m.providerName}
                {m.role ? <span className="text-muted-foreground"> ({ROLE_LABELS[m.role]})</span> : null}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>
            {selected.role === 'primary'
              ? 'Narrates your courses.'
              : selected.role === 'fallback'
                ? 'Narrates when the Narration model fails.'
                : 'Not used for Narration yet.'}
          </span>
          {canEdit && selected.role !== 'primary' ? (
            <Button type="button" size="sm" variant="outline" disabled={setRoute.isPending} onClick={() => void routeToNarration(selected)}>
              {setRoute.isPending ? <Loader2Icon className="size-4 animate-spin" /> : null}
              Use for Narration
            </Button>
          ) : null}
        </div>
        {routeError ? <p className="text-sm text-destructive">{routeError}</p> : null}
      </div>
      <ModelVoicePanel key={selected.id} organizationId={organizationId} model={selected} profiles={profiles} canEdit={canEdit} />
    </div>
  )
}

/* Loads one model's voices, then mounts its form with that model's saved values. */
function ModelVoicePanel({
  organizationId,
  model,
  profiles,
  canEdit,
}: {
  organizationId: string
  model: NarrationModelChoice
  profiles: readonly SavedNarrationVoice[]
  canEdit: boolean
}) {
  const voices = trpc.aiProviders.listVoices.useQuery(
    { organizationId, aiModelId: model.id },
    { staleTime: 5 * 60_000, retry: false }
  )
  if (voices.isLoading) return <Skeleton className="h-40 w-full" />
  if (!voices.data) return <p className="text-sm text-destructive">{voices.error?.message ?? 'Could not load voices.'}</p>

  const options = voices.data
  const resolved = resolveVoiceForModel(
    { id: options.aiModelId, modelId: options.modelId, kind: options.providerKind, voices: options.voices.map((v) => v.id) },
    profiles
  )
  /* A default the provider's own list does not have falls back to its first voice. */
  const known = options.voices.length === 0 || options.voices.some((v) => v.id === resolved.voice)
  const initial = { ...resolved, voice: known ? resolved.voice : options.defaultVoice }
  const hasOwnVoice = profiles.some((p) => p.aiModelId === model.id)

  return <VoiceProfileForm organizationId={organizationId} options={options} initial={initial} hasOwnVoice={hasOwnVoice} canEdit={canEdit} />
}

function VoiceProfileForm({
  organizationId,
  options,
  initial,
  hasOwnVoice,
  canEdit,
}: {
  organizationId: string
  options: NarrationVoiceModel
  initial: Omit<SaveVoiceProfileValues, 'organizationId' | 'aiModelId'>
  hasOwnVoice: boolean
  canEdit: boolean
}) {
  const utils = trpc.useUtils()
  const save = trpc.aiProviders.saveVoice.useMutation()
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const audioRef = React.useRef<HTMLAudioElement>(null)

  const form = useForm<SaveVoiceProfileValues>({
    resolver: zodResolver(saveVoiceProfileSchema),
    defaultValues: { organizationId, aiModelId: options.aiModelId, ...initial },
  })
  const voice = useWatch({ control: form.control, name: 'voice' })
  const speedRange = options.controls.speed
  const unsupported = [!speedRange ? 'speed' : null, !options.controls.style ? 'speaking style' : null].filter(Boolean)

  async function preview() {
    const valid = await form.trigger()
    if (!valid) return
    setError(null)
    setMessage(null)
    setPreviewing(true)
    try {
      const sample = await utils.client.aiProviders.previewVoice.query(form.getValues())
      if (audioRef.current) {
        audioRef.current.src = sample.dataUrl
        await audioRef.current.play()
      }
      setMessage(`Playing a sample from ${sample.model}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not play a sample.')
    } finally {
      setPreviewing(false)
    }
  }

  async function onSubmit(values: SaveVoiceProfileValues) {
    setError(null)
    setMessage(null)
    try {
      await save.mutateAsync(values)
      /* A typed voice joins the model's list, so the voice list reloads too. */
      await Promise.all([
        utils.aiProviders.listVoiceProfiles.invalidate({ organizationId }),
        utils.aiProviders.listVoices.invalidate({ organizationId, aiModelId: values.aiModelId }),
        utils.aiProviders.list.invalidate({ organizationId }),
      ])
      setMessage(`Voice saved for ${options.displayName}. Generate narration to apply it to existing courses.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the voice.')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-5" noValidate>
        <FormField
          control={form.control}
          name="voice"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Voice</FormLabel>
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {options.voices.map(({ id, label, description }) => (
                  <button
                    key={id}
                    type="button"
                    disabled={!canEdit}
                    title={description ?? undefined}
                    onClick={() => field.onChange(id)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-sm capitalize transition-colors',
                      voice === id ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted/50'
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {/* Voices are picked by name; raw ids are typed only when a model has none to pick (add more in its model dialog). */}
              {options.voices.length === 0 ? (
                <FormControl>
                  <Input disabled={!canEdit} placeholder="Type a voice id your provider supports" {...field} />
                </FormControl>
              ) : null}
              <FormDescription>
                {VOICE_SOURCE_COPY[options.source](options)}
                {unsupported.length > 0 ? ` This model does not use ${unsupported.join(' or ')}.` : ''}
              </FormDescription>
              {options.notice ? (
                <p className={cn('rounded-md border bg-muted/40 px-3 py-2 text-sm', NOTICE_TONE_CLASS[options.notice.tone])}>
                  {options.notice.message}
                </p>
              ) : null}
              <FormMessage />
            </FormItem>
          )}
        />
        {speedRange ? (
          <FormField
            control={form.control}
            name="speed"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Speed</FormLabel>
                <div className="flex flex-wrap gap-1.5">
                  {SPEEDS.filter((s) => s >= speedRange.min && s <= speedRange.max).map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={!canEdit}
                      onClick={() => field.onChange(s)}
                      className={cn(
                        'rounded-full border px-3 py-1 font-mono text-sm tabular-nums transition-colors',
                        field.value === s ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted/50'
                      )}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        {options.controls.style ? (
          <FormField
            control={form.control}
            name="instructions"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Speaking style</FormLabel>
                <FormControl>
                  <Textarea disabled={!canEdit} rows={2} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}
        {!hasOwnVoice ? (
          <p className="text-sm text-muted-foreground">No voice saved for this model yet. Save one to keep it.</p>
        ) : null}
        {/* Sample playback target; captions are not meaningful for a voice sample. */}
        <audio ref={audioRef} className="hidden" />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
        {canEdit ? (
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={previewing} onClick={() => void preview()}>
              {previewing ? <Loader2Icon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}
              Preview voice
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? <Loader2Icon className="size-4 animate-spin" /> : null}
              Save voice
            </Button>
          </div>
        ) : null}
      </form>
    </Form>
  )
}
