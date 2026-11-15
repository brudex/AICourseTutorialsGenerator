'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: ConnectionsSettings, platform list, connect
 *   YouTube button, connect Google Classroom, connect Canvas, disconnect
 *   platform, sign in to connect, import guides dialog
 *
 * WHAT:  The Connections page: one card per platform (logo, status,
 *        connected accounts, one Connect button), then the "Import by hand"
 *        platforms (Udemy, Moodle, Thinkific, Teachable) with their steps.
 * WHY:   Customers never see keys or settings: Connect sends them to sign in
 *        to their own account (URL from publishing.connectUrl, using the
 *        operator's OAuth apps) and they come back connected. Canvas and
 *        LearnDash first ask for the site address. Platform text comes from
 *        PUBLISHING_PLATFORMS.
 * WHERE: /dashboard/settings/connections.
 */

import * as React from 'react'
import { useSearchParams } from 'next/navigation'
import Image from 'next/image'
import { BookOpenIcon, CheckCircle2Icon, Loader2Icon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'

import { PublishingPlatform } from '@/generated/prisma'
import { trpc } from '@/trpc/react-provider'
import { useActiveOrganization } from '@/hooks/use-active-organization'
import { permissions } from '@/lib/permissions'
import {
  OFFERED_PUBLISHING_PLATFORMS,
  PUBLISHING_EXPORT_GUIDES,
  PUBLISHING_EXPORT_GUIDES_ENABLED,
  PUBLISHING_PLATFORMS,
  type ExportGuide,
} from '@/lib/config/publishing'
import { cn } from '@/lib/utils'
import { PublishingPlatformIcon } from '@/components/global/publishing'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { ConnectCanvasDialog } from './connect-canvas-dialog'
import { ConnectWordPressDialog } from './connect-wordpress-dialog'
import { ConnectSchoolDialog } from './connect-school-dialog'

function asPublishingPlatform(value: string | null): PublishingPlatform | null {
  return Object.values(PublishingPlatform).find((platform) => platform === value) ?? null
}

export function ConnectionsSettings() {
  const { activeOrganization, hasPermission } = useActiveOrganization()
  const organizationId = activeOrganization?.id ?? ''
  const utils = trpc.useUtils()
  const params = useSearchParams()
  const setup = trpc.publishing.getSetup.useQuery({ organizationId }, { enabled: organizationId !== '' })
  const disconnect = trpc.publishing.disconnect.useMutation()
  const [canvasOpen, setCanvasOpen] = React.useState(false)
  const [wordpressOpen, setWordpressOpen] = React.useState(false)
  const [schoolOpen, setSchoolOpen] = React.useState(false)
  const [guide, setGuide] = React.useState<ExportGuide | null>(null)
  const [starting, setStarting] = React.useState<PublishingPlatform | null>(null)
  const [removing, setRemoving] = React.useState<{ id: string; name: string } | null>(null)

  const canConnect = hasPermission(permissions.PUBLISHING_CREATE)
  const canRemove = hasPermission(permissions.PUBLISHING_DELETE)
  const connectedPlatform = asPublishingPlatform(params.get('connected'))
  const callbackError = params.get('error')

  /* Site-based platforms ask for the address first; the rest go straight to sign-in. */
  async function connect(platform: PublishingPlatform) {
    const kind = PUBLISHING_PLATFORMS[platform].connect
    if (kind === 'canvas') return setCanvasOpen(true)
    if (kind === 'wordpress') return setWordpressOpen(true)
    if (kind === 'school') return setSchoolOpen(true)
    setStarting(platform)
    try {
      const { url } = await utils.client.publishing.connectUrl.query({ organizationId, platform, baseUrl: null })
      if (url) window.location.assign(url)
    } catch (error) {
      setStarting(null)
      toast.error(error instanceof Error ? error.message : 'Could not start the connection.')
    }
  }

  /* Sign-in platforms need the operator's app keys; until then they wait. */
  function isAvailable(platform: PublishingPlatform) {
    const kind = PUBLISHING_PLATFORMS[platform].connect
    if (kind === 'google') return data?.signIn.google ?? false
    if (kind === 'vimeo') return data?.signIn.vimeo ?? false
    return true
  }

  async function confirmRemove() {
    if (!removing) return
    try {
      await disconnect.mutateAsync({ organizationId, connectionId: removing.id })
      await utils.publishing.getSetup.invalidate({ organizationId })
      toast.success(`Disconnected ${removing.name}.`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not disconnect.')
    } finally {
      setRemoving(null)
    }
  }

  if (!activeOrganization) return null
  const data = setup.data
  const connections = data?.connections ?? []

  return (
    <div className="space-y-6">
      {connectedPlatform ? (
        <Alert>
          <CheckCircle2Icon />
          <AlertTitle>{PUBLISHING_PLATFORMS[connectedPlatform].label} is connected</AlertTitle>
          <AlertDescription>Open a course and choose Publish.</AlertDescription>
        </Alert>
      ) : null}
      {callbackError ? (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>The connection did not finish</AlertTitle>
          <AlertDescription>{callbackError}</AlertDescription>
        </Alert>
      ) : null}

      {setup.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {OFFERED_PUBLISHING_PLATFORMS.map((platform) => (
            <Skeleton key={platform} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {OFFERED_PUBLISHING_PLATFORMS.map((platform) => {
            const definition = PUBLISHING_PLATFORMS[platform]
            const accounts = connections.filter((c) => c.platform === platform)
            const connected = accounts.length > 0
            const available = isAvailable(platform)
            return (
              <div
                key={platform}
                className={cn('flex flex-col gap-3 rounded-xl border bg-card p-4', connected && 'border-success-border/60')}
              >
                <div className="flex items-center gap-3">
                  <PublishingPlatformIcon platform={platform} />
                  <p className="min-w-0 flex-1 truncate font-medium">{definition.label}</p>
                  {connected ? (
                    <Badge className="gap-1 border-success-border/60 bg-success/15 text-success">
                      <CheckCircle2Icon className="size-3" />
                      Connected
                    </Badge>
                  ) : !available ? (
                    <Badge variant="outline">Coming soon</Badge>
                  ) : null}
                </div>
                <p className="line-clamp-2 text-xs text-muted-foreground">{definition.description}</p>
                {connected ? (
                  <ul className="space-y-1">
                    {accounts.map((account) => (
                      <li key={account.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
                        <span className="truncate">{account.name}</span>
                        {canRemove ? (
                          <button
                            type="button"
                            className="shrink-0 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                            onClick={() => setRemoving({ id: account.id, name: account.name })}
                          >
                            Disconnect
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {canConnect ? (
                  <Button
                    variant={connected ? 'outline' : 'default'}
                    size="sm"
                    className="mt-auto w-full"
                    disabled={!available || starting !== null}
                    onClick={() => void connect(platform)}
                  >
                    {starting === platform ? <Loader2Icon className="size-4 animate-spin" /> : null}
                    {!available ? 'Available soon' : connected ? 'Add another account' : 'Connect'}
                  </Button>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      {/* Platforms that only take content in their own editors: honest import guides. */}
      {PUBLISHING_EXPORT_GUIDES_ENABLED ? (
        <div className="space-y-3">
          <div>
            <p className="font-medium">Import by hand</p>
            <p className="text-sm text-muted-foreground">These platforms only accept courses in their own editors. Export a package and follow the steps.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {PUBLISHING_EXPORT_GUIDES.map((item) => (
              <div key={item.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-logo-surface p-1.5">
                  {item.logo ? (
                    <Image src={item.logo} alt={`${item.label} logo`} width={24} height={24} className="size-full object-contain" />
                  ) : (
                    <BookOpenIcon className="size-4 text-muted-foreground" aria-hidden />
                  )}
                </span>
                <p className="min-w-0 flex-1 truncate font-medium">{item.label}</p>
                <Button variant="ghost" size="sm" onClick={() => setGuide(item)}>
                  How to
                </Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <ConnectCanvasDialog organizationId={organizationId} open={canvasOpen} onOpenChange={setCanvasOpen} />
      <ConnectWordPressDialog organizationId={organizationId} open={wordpressOpen} onOpenChange={setWordpressOpen} />
      <ConnectSchoolDialog organizationId={organizationId} open={schoolOpen} onOpenChange={setSchoolOpen} />

      <Dialog open={guide !== null} onOpenChange={(open) => (open ? null : setGuide(null))}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Import into {guide?.label}</DialogTitle>
            <DialogDescription>{guide?.reason}</DialogDescription>
          </DialogHeader>
          <ol className="list-decimal space-y-2 pl-4 text-sm">
            {(guide?.steps ?? []).map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removing !== null} onOpenChange={(open) => (open ? null : setRemoving(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>Courses already published stay there. You can connect again any time.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRemove()}>Disconnect</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
