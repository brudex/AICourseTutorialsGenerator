'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: ConnectSchoolDialog, connect your online school,
 *   school API key connect, hosted studio address
 *
 * WHAT:  Connects "Your online school": the hosted studio's address and a
 *        school API key from Students → API there. The server checks both
 *        (publishing.connectSchool) before saving.
 * WHY:   Lets courses built here (often on the desktop app) be published to
 *        the school where students learn. Validated with connectSchoolSchema.
 * WHERE: Settings → Connections.
 */

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { trpc } from '@/trpc/react-provider'
import { connectSchoolSchema, type ConnectSchoolValues } from '@/lib/types'
import { PasswordInput } from '@/components/global/password-input'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

export interface ConnectSchoolDialogProps {
  organizationId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ConnectSchoolDialog({ organizationId, open, onOpenChange }: ConnectSchoolDialogProps) {
  const utils = trpc.useUtils()
  const connect = trpc.publishing.connectSchool.useMutation()
  const form = useForm<ConnectSchoolValues>({ resolver: zodResolver(connectSchoolSchema), defaultValues: { organizationId, baseUrl: '', apiKey: '' } })

  async function submit(values: ConnectSchoolValues) {
    try {
      const saved = await connect.mutateAsync(values)
      await utils.publishing.getSetup.invalidate({ organizationId })
      toast.success(`Connected ${saved.name}.`)
      form.reset({ organizationId, baseUrl: '', apiKey: '' })
      onOpenChange(false)
    } catch (error) {
      form.setError('apiKey', { message: error instanceof Error ? error.message : 'Could not connect.' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Connect your online school</DialogTitle>
          <DialogDescription>Publish courses from here to the school on your hosted studio.</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
            <FormField control={form.control} name="baseUrl" render={({ field }) => (
              <FormItem>
                <FormLabel>Studio address</FormLabel>
                <FormControl><Input placeholder="https://app.yourdomain.com" autoCapitalize="none" autoCorrect="off" {...field} /></FormControl>
                <FormDescription>The address you sign in to on the web.</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="apiKey" render={({ field }) => (
              <FormItem>
                <FormLabel>School API key</FormLabel>
                <FormControl><PasswordInput placeholder="acs_…" autoComplete="off" {...field} /></FormControl>
                <FormDescription>On the hosted studio: Students → API → New key.</FormDescription>
                <FormMessage />
              </FormItem>
            )} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={connect.isPending}>{connect.isPending ? <Loader2Icon className="size-4 animate-spin" /> : null}Connect</Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
