'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: ConnectCanvasDialog, sign in with Canvas,
 *   Canvas address step, siteAddressSchema, Canvas access token fallback,
 *   connectCanvasSchema
 *
 * WHAT:  Connects a Canvas site. Step one asks for the school's Canvas
 *        address; if the operator registered a developer key for that school
 *        the browser goes to the Canvas login to approve. Otherwise step two
 *        offers the access-token fallback for that same address.
 * WHY:   Most teachers should only type their school's address and sign in.
 *        Schools differ (each runs its own Canvas and issues its own keys),
 *        so the token fallback keeps every school connectable while one-click
 *        keys are arranged. The server checks a token with Canvas before
 *        saving it, and encrypts it.
 * WHERE: ConnectionsSettings (Connect Canvas).
 */

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { PublishingPlatform } from '@/generated/prisma'
import { trpc } from '@/trpc/react-provider'
import {
  siteAddressSchema,
  connectCanvasSchema,
  type SiteAddressValues,
  type ConnectCanvasValues,
} from '@/lib/types'
import { PasswordInput } from '@/components/global/password-input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

export interface ConnectCanvasDialogProps {
  organizationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ConnectCanvasDialog({ organizationId, open, onOpenChange }: ConnectCanvasDialogProps) {
  /* Set when the school has no one-click sign-in: show the token step. */
  const [tokenFor, setTokenFor] = React.useState<string | null>(null)

  function close(next: boolean) {
    if (!next) setTokenFor(null)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Connect Canvas</DialogTitle>
          <DialogDescription>
            {tokenFor
              ? 'Your school does not have one-click sign-in yet. You can connect with an access token instead.'
              : 'Enter the address you open Canvas at. You will sign in to Canvas to approve.'}
          </DialogDescription>
        </DialogHeader>
        {tokenFor ? (
          <TokenStep organizationId={organizationId} baseUrl={tokenFor} onBack={() => setTokenFor(null)} onDone={() => close(false)} />
        ) : (
          <AddressStep organizationId={organizationId} onNeedsToken={setTokenFor} onCancel={() => close(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function AddressStep({
  organizationId,
  onNeedsToken,
  onCancel,
}: {
  organizationId: string
  onNeedsToken: (baseUrl: string) => void
  onCancel: () => void
}) {
  const utils = trpc.useUtils()
  const [error, setError] = React.useState<string | null>(null)
  const form = useForm<SiteAddressValues>({ resolver: zodResolver(siteAddressSchema), defaultValues: { baseUrl: '' } })

  async function onSubmit(values: SiteAddressValues) {
    setError(null)
    const baseUrl = siteAddressSchema.parse(values).baseUrl
    try {
      const { url } = await utils.client.publishing.connectUrl.query({ organizationId, platform: PublishingPlatform.CANVAS, baseUrl })
      if (url) window.location.assign(url)
      else onNeedsToken(baseUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the connection.')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <FormField
          control={form.control}
          name="baseUrl"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Your school’s Canvas address</FormLabel>
              <FormControl>
                <Input placeholder="https://school.instructure.com" autoComplete="url" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Continue
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}

function TokenStep({
  organizationId,
  baseUrl,
  onBack,
  onDone,
}: {
  organizationId: string
  baseUrl: string
  onBack: () => void
  onDone: () => void
}) {
  const utils = trpc.useUtils()
  const connect = trpc.publishing.connectCanvas.useMutation()
  const [error, setError] = React.useState<string | null>(null)
  const form = useForm<ConnectCanvasValues>({
    resolver: zodResolver(connectCanvasSchema),
    defaultValues: { organizationId, baseUrl, token: '' },
  })

  async function onSubmit(values: ConnectCanvasValues) {
    setError(null)
    try {
      const connection = await connect.mutateAsync({ ...values, organizationId })
      await utils.publishing.getSetup.invalidate({ organizationId })
      toast.success(`Connected ${connection.name}.`)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect Canvas.')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <FormField
          control={form.control}
          name="token"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Access token</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="off" {...field} />
              </FormControl>
              <FormDescription>In Canvas, open Account, then Settings, then New access token.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button type="submit" disabled={connect.isPending}>
            {connect.isPending ? <Loader2Icon className="size-4 animate-spin" /> : null}
            {connect.isPending ? 'Checking with Canvas…' : 'Connect'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
