'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: NarrationVoiceForm, narration voice settings,
 *   preview voice, VoiceProfile form, aiProviders.listVoices, live voices,
 *   voice controls, fallback voice
 *
 * WHAT:  Picks the workspace narration voice (voice id, speed, speaking
 *        style) for the model routed to Narration and plays a sample.
 * WHY:   Voice is chosen by ear, so Preview plays real audio before saving.
 *        The voices come from the provider itself when it can list them
 *        (ElevenLabs, local servers) and from the built-in catalog
 *        otherwise (aiProviders.listVoices). Only the controls the model
 *        honours are shown. The voice is saved with the model it belongs to,
 *        so a rerouted or fallback model speaks with its own default voice
 *        instead of failing on a foreign id.
 * WHERE: Narration voice section of AiProvidersSettings.
 */

import * as React from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon, PlayIcon } from 'lucide-react'

import { trpc } from '@/trpc/react-provider'
import { resolveVoiceForModel } from '@/lib/config'
import { saveVoiceProfileSchema, type SaveVoiceProfileValues } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

const SPEEDS = [0.75, 0.9, 1, 1.1, 1.2, 1.25, 1.5] as const

export function NarrationVoiceForm({
  organizationId,
  initial,
  saved,
  canEdit,
}: {
  organizationId: string
  initial: Omit<SaveVoiceProfileValues, 'organizationId'>
  /* False while the workspace still uses the built-in default voice. */
  saved: boolean
  canEdit: boolean
}) {
  const utils = trpc.useUtils()
  const save = trpc.aiProviders.saveVoice.useMutation()
  const options = trpc.aiProviders.listVoices.useQuery({ organizationId }, { staleTime: 5 * 60_000, retry: false })
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const audioRef = React.useRef<HTMLAudioElement>(null)

  const form = useForm<SaveVoiceProfileValues>({
    resolver: zodResolver(saveVoiceProfileSchema),
    defaultValues: { organizationId, ...initial },
  })
  const [voice, aiModelId] = useWatch({ control: form.control, name: ['voice', 'aiModelId'] })
  const primary = options.data?.primary ?? null
  const fallback = options.data?.fallback ?? null

  /* A voice belongs to one model: when Narration points at another model,
   * keep the voice only if that model has it, else start from its default. */
  React.useEffect(() => {
    if (!primary || form.getValues('aiModelId') === primary.aiModelId) return
    const stillValid = primary.voices.some((v) => v.id === form.getValues('voice'))
    form.setValue('aiModelId', primary.aiModelId, { shouldDirty: true })
    if (stillValid) return
    form.setValue('voice', primary.defaultVoice, { shouldDirty: true })
  }, [primary, form])
  /* Shown until a voice is saved for the routed model. */
  const savedForOtherModel =
    saved && primary !== null && initial.aiModelId !== primary.aiModelId && !primary.voices.some((v) => v.id === initial.voice)

  const speedRange = primary?.controls.speed ?? null
  const unsupported = [!speedRange ? 'speed' : null, primary && !primary.controls.style ? 'speaking style' : null].filter(Boolean)
  const fallbackVoiceId = fallback
    ? resolveVoiceForModel({ id: fallback.aiModelId, modelId: fallback.modelId, kind: fallback.providerKind }, { aiModelId, voice })
    : null
  const fallbackVoiceLabel = fallback?.voices.find((v) => v.id === fallbackVoiceId)?.label ?? fallbackVoiceId

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
      await utils.aiProviders.getVoice.invalidate({ organizationId })
      setMessage('Voice saved. Generate narration to apply it to existing courses.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the voice.')
    }
  }

  if (options.isLoading) return <Skeleton className="h-40 w-full max-w-xl" />
  if (!primary) {
    return <p className="text-sm text-muted-foreground">Route a model to Narration above to pick its voice.</p>
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex max-w-xl flex-col gap-5" noValidate>
        <FormField
          control={form.control}
          name="voice"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Voice</FormLabel>
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">
                {primary.voices.map(({ id, label, description }) => (
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
              <FormControl>
                <Input disabled={!canEdit} placeholder="Or type any voice id your provider supports" {...field} />
              </FormControl>
              <FormDescription>
                {primary.source === 'live'
                  ? `Voices loaded from ${primary.providerName} for ${primary.displayName}.`
                  : `Built in voices for ${primary.displayName}.`}
                {unsupported.length > 0 ? ` This model does not use ${unsupported.join(' or ')}.` : ''}
              </FormDescription>
              {primary.notice ? <p className="text-sm text-destructive">{primary.notice}</p> : null}
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
        {primary.controls.style ? (
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
        {fallback ? (
          <p className="text-sm text-muted-foreground">
            If {primary.displayName} fails, {fallback.displayName} narrates with {fallbackVoiceLabel}.
          </p>
        ) : null}
        {savedForOtherModel ? (
          <p className="text-sm text-muted-foreground">
            Your saved voice belongs to another model. Pick a voice for {primary.displayName} and save.
          </p>
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
