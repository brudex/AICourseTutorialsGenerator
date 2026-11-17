'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: ConnectWordPressDialog, connect LearnDash,
 *   WordPress approval, application password, siteAddressSchema,
 *   connectWordPressSchema
 *
 * WHAT:  Connects a WordPress site running LearnDash. Step one asks for the
 *        site address; on an https app the browser goes to WordPress's own
 *        approval page and comes back connected. Otherwise (local or desktop
 *        app on http, where WordPress will not redirect back) step two opens
 *        the same approval page in a new tab and asks for the username and the
 *        password WordPress shows there.
 * WHY:   No developer keys are needed for WordPress: the site owner approves
 *        access in their own admin. The server checks the password and that
 *        LearnDash's REST API is on before saving, and encrypts it.
 * WHERE: ConnectionsSettings (Connect LearnDash).
 */

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ExternalLinkIcon, Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { PublishingPlatform } from '@/generated/prisma'
import { trpc } from '@/trpc/react-provider'
import { useBranding } from '@/components/global/branding'
import {
  connectWordPressSchema,
  siteAddressSchema,
  type ConnectWordPressValues,
  type SiteAddressValues,
} from '@/lib/types'
import { PasswordInput } from '@/components/global/password-input'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

export interface ConnectWordPressDialogProps {
  organizationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ConnectWordPressDialog({ organizationId, open, onOpenChange }: ConnectWordPressDialogProps) {
  /* Set when the approval has to be finished by hand. */
  const [manualFor, setManualFor] = React.useState<string | null>(null)

  function close(next: boolean) {
    if (!next) setManualFor(null)
    onOpenChange(next)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Connect LearnDash</DialogTitle>
          <DialogDescription>
            {manualFor
              ? 'Approve access in WordPress, then paste the username and the password it shows you.'
              : 'Enter your WordPress site address. You will approve access in WordPress.'}
          </DialogDescription>
        </DialogHeader>
        {manualFor ? (
          <ManualStep organizationId={organizationId} baseUrl={manualFor} onBack={() => setManualFor(null)} onDone={() => close(false)} />
        ) : (
          <AddressStep organizationId={organizationId} onManual={setManualFor} onCancel={() => close(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function AddressStep({ organizationId, onManual, onCancel }: { organizationId: string; onManual: (baseUrl: string) => void; onCancel: () => void }) {
  const utils = trpc.useUtils()
  const [error, setError] = React.useState<string | null>(null)
  const form = useForm<SiteAddressValues>({ resolver: zodResolver(siteAddressSchema), defaultValues: { baseUrl: '' } })

  async function onSubmit(values: SiteAddressValues) {
    setError(null)
    const baseUrl = siteAddressSchema.parse(values).baseUrl
    try {
      const { url } = await utils.client.publishing.connectUrl.query({ organizationId, platform: PublishingPlatform.LEARNDASH, baseUrl })
      if (url) window.location.assign(url)
      else onManual(baseUrl)
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
              <FormLabel>WordPress site address</FormLabel>
              <FormControl>
                <Input placeholder="https://academy.example.com" autoComplete="url" {...field} />
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

function ManualStep({ organizationId, baseUrl, onBack, onDone }: { organizationId: string; baseUrl: string; onBack: () => void; onDone: () => void }) {
  const utils = trpc.useUtils()
  const { appName } = useBranding()
  const connect = trpc.publishing.connectWordPress.useMutation()
  const [error, setError] = React.useState<string | null>(null)
  const form = useForm<ConnectWordPressValues>({
    resolver: zodResolver(connectWordPressSchema),
    defaultValues: { organizationId, baseUrl, username: '', appPassword: '' },
  })
  const approvalUrl = `${baseUrl}/wp-admin/authorize-application.php?${new URLSearchParams({ app_name: appName }).toString()}`

  async function onSubmit(values: ConnectWordPressValues) {
    setError(null)
    try {
      const connection = await connect.mutateAsync({ ...values, organizationId })
      await utils.publishing.getSetup.invalidate({ organizationId })
      toast.success(`Connected ${connection.name}.`)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect this site.')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
        <a href={approvalUrl} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'outline' })}>
          Open WordPress to approve
          <ExternalLinkIcon className="size-4" />
        </a>
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>WordPress username</FormLabel>
              <FormControl>
                <Input autoComplete="off" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="appPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password WordPress showed</FormLabel>
              <FormControl>
                <PasswordInput autoComplete="off" {...field} />
              </FormControl>
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
            {connect.isPending ? 'Checking the site…' : 'Connect'}
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
