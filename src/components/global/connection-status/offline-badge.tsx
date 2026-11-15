'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: OfflineBadge, OFFLINE_ACTION_HINT, no internet
 *   badge, back online toast, connection status indicator
 *
 * WHAT:  A small "Offline" badge (with an explanation on hover) that shows
 *        only while there is no internet, and a "Back online" toast when the
 *        connection returns. OFFLINE_ACTION_HINT is the one sentence used on
 *        every button that needs the internet.
 * WHY:   Without it people only found out they were offline when an AI step
 *        failed. Theme tokens only, so it fits light and dark pages.
 * WHERE: PageHeader (every studio and student app page); the hint on the
 *        generate, publish and retry buttons.
 */

import * as React from 'react'
import { WifiOffIcon } from 'lucide-react'
import { toast } from 'sonner'

import { useOnlineStatus } from '@/hooks/use-online-status'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export const OFFLINE_ACTION_HINT = 'You are offline. Generating and publishing need the internet, so this will be ready when you reconnect.'

const OFFLINE_DETAIL = 'You are offline. You can keep working; anything that needs the internet will be ready when you reconnect.'

export function OfflineBadge() {
  const online = useOnlineStatus()
  const wasOffline = React.useRef(false)

  React.useEffect(() => {
    if (!online) wasOffline.current = true
    else if (wasOffline.current) {
      wasOffline.current = false
      /* Green so reconnecting reads at a glance (theme success tokens). */
      toast.success('Back online.', { className: 'border-success-border! bg-success! text-success-foreground!' })
    }
  }, [online])

  if (online) return null
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span role="status" className="inline-flex h-7 items-center gap-1.5 rounded-full border border-destructive/40 bg-destructive/10 px-2.5 text-xs font-medium text-destructive" />}
      >
        <WifiOffIcon className="size-3.5" />
        Offline
      </TooltipTrigger>
      <TooltipContent className="max-w-64">{OFFLINE_DETAIL}</TooltipContent>
    </Tooltip>
  )
}
