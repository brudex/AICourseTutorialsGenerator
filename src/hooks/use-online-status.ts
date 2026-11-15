'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: useOnlineStatus, offline detection, no internet,
 *   navigator.onLine, online offline events, connection status hook
 *
 * WHAT:  True while the device has a network connection, false when it goes
 *        offline; updates live from the browser's online/offline events.
 * WHY:   The desktop app works offline (its server and database are local),
 *        but AI generation and publishing need the internet. One shared hook
 *        lets the badge and every internet-only button agree. Built on
 *        useSyncExternalStore so it is hydration safe (the server assumes
 *        online).
 * WHERE: OfflineBadge (page header) and the generate / publish / retry
 *        buttons in the course studio.
 */

import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
}
