'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: NarrationVoiceForm, narration voice settings,
 *   preview voice, VoiceProfile form
 *
 * WHAT:  Picks the workspace narration voice (voice id, speed, speaking
 *        style) and plays a sample with the routed TTS model.
 * WHY:   Voice is chosen by ear, so Preview plays real audio before saving.
 *        The TTS model itself comes from the Narration capability route; this
 *        form only picks the voice on it, and its one-click voices are the
 *        ones that model accepts (voiceSuggestionsFor).
 * WHERE: Narration voice section of AiProvidersSettings.
 */

import * as React from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon, PlayIcon } from 'lucide-react'

import { trpc } from '@/trpc/react-provider'
import { voiceSuggestionsFor } from '@/lib/config'
import { VOICE_SPEED_LIMITS, saveVoiceProfileSchema, type SaveVoiceProfileValues } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const SPEEDS = [0.75, 0.9, 1, 1.1, 1.25, 1.5] as const

export function NarrationVoiceForm({
  organizationId,
  initial,
  canEdit,
  narrationModelId,
}: {
  organizationId: string
  initial: { voice: string; speed: number; instructions: string }
  canEdit: boolean
  /* Provider model id routed to Narration; null when none is routed. */
  narrationModelId: string | null
}) {
  const utils = trpc.useUtils()
  const save = trpc.aiProviders.saveVoice.useMutation()
  const [message, setMessage] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const audioRef = React.useRef<HTMLAudioElement>(null)

  const form = useForm<SaveVoiceProfileValues>({
    resolver: zodResolver(saveVoiceProfileSchema),
    defaultValues: { organizationId, ...initial },
  })
  const voice = useWatch({ control: form.control, name: 'voice' })

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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex max-w-xl flex-col gap-5" noValidate>
        <FormField
          control={form.control}
          name="voice"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Voice</FormLabel>
              <div className="flex flex-wrap gap-1.5">
                {voiceSuggestionsFor(narrationModelId).map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    disabled={!canEdit}
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
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="speed"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Speed</FormLabel>
              <div className="flex flex-wrap gap-1.5">
                {SPEEDS.filter((s) => s >= VOICE_SPEED_LIMITS.min && s <= VOICE_SPEED_LIMITS.max).map((s) => (
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
        <FormField
          control={form.control}
          name="instructions"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Speaking style</FormLabel>
              <FormControl>
                <Textarea disabled={!canEdit} rows={2} {...field} />
              </FormControl>
              <FormDescription>Used by models that support style instructions.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
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
