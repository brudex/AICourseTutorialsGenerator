/**
 * SOURCE OF TRUTH KEYWORDS: AppFrame, AppFrameProps, AppFrameSteps, focus
 *   layout, full page flow shell, onboarding shell, horizontal stepper
 *
 * WHAT:  The dashboard's look for screens outside the dashboard: the blue
 *        frame around the rounded content panel that fades from the frame
 *        colour into the background (as SidebarInset does), with the logo and
 *        an actions slot on top and the flow centred inside the panel, under
 *        an optional horizontal stepper.
 * WHY:   Creating an organization is one focused task, so there is no
 *        sidebar: everything sits centred in the main panel. Same theme
 *        tokens as the dashboard (bg-sidebar, from-sidebar/45), so a brand
 *        change reaches both.
 * WHERE: Onboarding (src/app/(onboarding)/onboarding/_components/onboarding-flow.tsx).
 */

import type { Route } from 'next'
import * as React from 'react'
import { CheckIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { PlatformLogo } from '@/components/global/platform-logo'

const WIDTHS = { sm: 'max-w-xl', md: 'max-w-3xl', lg: 'max-w-5xl' } as const

export interface AppFrameProps {
  children: React.ReactNode
  /** Where the logo links to. */
  homeHref?: Route
  /** Top right of the panel (e.g. "Back to dashboard"). */
  actions?: React.ReactNode
  /** Above the content, centred (e.g. AppFrameSteps). */
  stepper?: React.ReactNode
  width?: keyof typeof WIDTHS
}

export function AppFrame({ children, homeHref = '/', actions, stepper, width = 'sm' }: AppFrameProps) {
  return (
    <div className="flex min-h-svh bg-sidebar p-2">
      <main className="flex flex-1 flex-col rounded-xl bg-linear-to-br from-sidebar/45 via-background via-40% to-background text-foreground shadow-sm">
        <header className="flex h-16 items-center justify-between gap-3 px-6 md:px-8">
          <PlatformLogo href={homeHref} />
          {actions}
        </header>
        <div className={cn('mx-auto w-full flex-1 px-6 pt-6 pb-16 md:pt-12', WIDTHS[width])}>
          {stepper ? <div className="mb-10 flex justify-center">{stepper}</div> : null}
          {children}
        </div>
      </main>
    </div>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: AppFrameSteps, onboarding stepper
 * WHAT:  A horizontal stepper: numbered circles joined by lines, done steps
 *        ticked, the current one in the primary colour with its label.
 */
export function AppFrameSteps({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol className="flex items-center gap-3" aria-label="Progress">
      {steps.map((label, i) => (
        <li key={label} className="flex items-center gap-3" aria-current={i === current ? 'step' : undefined}>
          {i > 0 ? <span className={cn('h-px w-8 sm:w-14', i <= current ? 'bg-primary' : 'bg-border')} aria-hidden /> : null}
          <span className="flex items-center gap-2">
            <span
              className={cn(
                'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                i < current && 'border-primary bg-primary text-primary-foreground',
                i === current && 'border-primary text-primary',
                i > current && 'text-muted-foreground'
              )}
            >
              {i < current ? <CheckIcon className="size-3.5" /> : i + 1}
            </span>
            <span className={cn('hidden text-sm sm:inline', i === current ? 'font-medium text-foreground' : 'text-muted-foreground')}>{label}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
