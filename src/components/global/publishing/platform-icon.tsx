'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: PublishingPlatformIcon, platform logo, YouTube
 *   logo, Google Classroom logo, Canvas logo, LOGO_SURFACE
 *
 * WHAT:  A publishing platform's brand mark on the light logo plate, in a
 *        fixed square. Sizes: sm (lists, dialog), md (cards).
 * WHY:   People recognise the platforms by their logos faster than by name.
 *        The logo path lives on PUBLISHING_PLATFORMS so every surface uses the
 *        same mark; the plate (--logo-surface) keeps brand colours true on the
 *        dark theme and the fixed box keeps rows aligned.
 * WHERE: Connections settings page, course Publish dialog, publications card.
 */

import Image from 'next/image'

import type { PublishingPlatform } from '@/generated/prisma'
import { PUBLISHING_PLATFORMS } from '@/lib/config/publishing'
import { cn } from '@/lib/utils'

const SIZES = {
  sm: { box: 'size-9 rounded-lg p-1.5', px: 24 },
  md: { box: 'size-11 rounded-xl p-2', px: 28 },
} as const

export interface PublishingPlatformIconProps {
  platform: PublishingPlatform
  size?: keyof typeof SIZES
  className?: string
}

export function PublishingPlatformIcon({ platform, size = 'sm', className }: PublishingPlatformIconProps) {
  const definition = PUBLISHING_PLATFORMS[platform]
  const dims = SIZES[size]
  return (
    <span className={cn('flex shrink-0 items-center justify-center bg-logo-surface', dims.box, className)}>
      <Image src={definition.logo} alt={`${definition.label} logo`} width={dims.px} height={dims.px} className="size-full object-contain" />
    </span>
  )
}
