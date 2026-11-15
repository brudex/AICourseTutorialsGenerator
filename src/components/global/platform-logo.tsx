/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: PlatformLogo, PlatformLogoProps, app icon logo
 *
 * WHAT:  The app's brand mark: the app icon (APP_LOGO) and APP_NAME.
 * WHY:   One reusable logo for the auth screens, onboarding and anything else
 *        that shows the product brand. The icon file is the single source, so
 *        rebranding means replacing public/brand/logo.png. `size` scales the
 *        mark for headers (sm) or hero panels (lg).
 * WHERE: AuthShell, onboarding.
 */

import type { Route } from 'next'
import Image from 'next/image'
import Link from 'next/link'

import { APP_LOGO, APP_NAME } from '@/lib/config/branding'
import { cn } from '@/lib/utils'

export interface PlatformLogoProps {
  href?: Route
  className?: string
  showName?: boolean
  size?: 'sm' | 'lg'
}

export function PlatformLogo({ href = '/', className, showName = true, size = 'sm' }: PlatformLogoProps) {
  const large = size === 'lg'
  const content = (
    <div className={cn('flex items-center font-semibold tracking-tight', large ? 'gap-3 text-xl' : 'gap-2', className)}>
      <Image src={APP_LOGO} alt="" width={large ? 48 : 28} height={large ? 48 : 28} priority className="shrink-0" />
      {showName ? <span>{APP_NAME}</span> : null}
    </div>
  )

  if (href) {
    return (
      <Link href={href} className="inline-flex">
        {content}
      </Link>
    )
  }
  return content
}
