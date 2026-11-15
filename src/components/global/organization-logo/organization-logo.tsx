'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: OrganizationLogo, OrganizationLogoProps, workspace
 *   logo, org avatar, logo fallback, organization switcher icon, LOGO_SURFACE
 *
 * WHAT:  An organization's logo fitted inside a fixed square on the light
 *        logo plate, or a building icon when it has no logo or the image fails
 *        to load. Sizes: sm (lists), md (sidebar switcher), lg (settings
 *        preview).
 * WHY:   Organizations set a logo URL in settings. The box is a fixed size so
 *        any logo shape keeps the layout still; the image is contained, never
 *        cropped or stretched. The plate (--logo-surface) is light because
 *        most logos are drawn for a white page, which also removes the dark
 *        bars a wide logo showed on the dark theme.
 * WHERE: Organization switcher (trigger and list), organization settings
 *        profile preview.
 */

import * as React from 'react'
import Image from 'next/image'
import { Building2Icon } from 'lucide-react'

import { cn } from '@/lib/utils'

/* FIXED_LOGO_BOX: every size is a fixed square, so a logo of any shape (or
 * none) takes exactly the same space and never pushes the layout around. */
const SIZES = {
  sm: { box: 'size-6 rounded-md', icon: 'size-3.5', px: 24 },
  md: { box: 'size-8 rounded-lg', icon: 'size-4', px: 32 },
  lg: { box: 'size-14 rounded-xl', icon: 'size-6', px: 56 },
} as const

export interface OrganizationLogoProps {
  name: string
  logo: string | null | undefined
  size?: keyof typeof SIZES
  className?: string
}

export function OrganizationLogo({ name, logo, size = 'md', className }: OrganizationLogoProps) {
  const dims = SIZES[size]
  /* Remember which URL failed, so editing the URL tries the new one. */
  const [failedUrl, setFailedUrl] = React.useState<string | null>(null)
  const showImage = Boolean(logo) && failedUrl !== logo

  if (!showImage || !logo) {
    return (
      <span
        className={cn(
          'flex shrink-0 items-center justify-center bg-sidebar-primary text-sidebar-primary-foreground',
          dims.box,
          className
        )}
        aria-hidden
      >
        <Building2Icon className={dims.icon} />
      </span>
    )
  }

  return (
    <span className={cn('flex shrink-0 items-center justify-center overflow-hidden bg-logo-surface p-0.5', dims.box, className)}>
      {/* `unoptimized`: logos are arbitrary external URLs, so they are not
          routed through the image optimizer (which would need every host
          listed in next.config). */}
      <Image
        src={logo}
        alt={name}
        width={dims.px}
        height={dims.px}
        unoptimized
        className="size-full object-contain"
        onError={() => setFailedUrl(logo)}
      />
    </span>
  )
}
