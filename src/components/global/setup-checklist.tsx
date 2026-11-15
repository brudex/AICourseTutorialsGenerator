/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: SetupChecklist, SETUP_ICONS, ProgressRing
 *
 * WHAT:  Full-screen developer setup gate — a minimal, stacked checklist of the
 *        required env vars: completed rows dim with a check, the next incomplete
 *        row is lifted with its one-line fix, and a progress indicator shows
 *        percent done.
 * WHY:   Shown by the root layout instead of the app when a required var is
 *        missing. Pure presentational server component; receives only
 *        key/label/help/icon/ok (never secret values). Uses theme tokens
 *        (background/card/muted/primary/…) — no hardcoded colors — so it matches
 *        the app theme.
 * WHERE: Rendered by src/app/layout.tsx when hasMissingRequiredEnv() is true.
 *        Items come from getEnvChecklist (src/lib/config/required-env.ts).
 */

import {
  CheckIcon,
  CircleIcon,
  CreditCardIcon,
  DatabaseIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  PlayCircleIcon,
  PlugIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from 'lucide-react'

import type { EnvChecklistItem, OptionalEnvItem } from '@/lib/config/required-env'
import { cn } from '@/lib/utils'

/* Maps RequiredEnvVar.icon strings to lucide components. */
const SETUP_ICONS: Record<string, LucideIcon> = {
  Database: DatabaseIcon,
  KeyRound: KeyRoundIcon,
  ShieldCheck: ShieldCheckIcon,
  CreditCard: CreditCardIcon,
  Plug: PlugIcon,
}

function iconFor(name: string): LucideIcon {
  return SETUP_ICONS[name] ?? CircleIcon
}

/* Shared link + video CTAs, used by both required and optional rows. */
function CtaLinks({
  link,
  video,
}: {
  link?: { label: string; url: string } | undefined
  video?: { url: string; label?: string | undefined } | undefined
}) {
  if (!link && !video) return null
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
      {link ? (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {link.label}
          <ExternalLinkIcon className="size-3" strokeWidth={2} />
        </a>
      ) : null}
      {video ? (
        <a
          href={video.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          <PlayCircleIcon className="size-3.5" strokeWidth={2} />
          {video.label ?? 'Watch setup video'}
        </a>
      ) : null}
    </div>
  )
}

/* Minimal circular progress indicator. Uses currentColor so it inherits the
 * surrounding text token. */
function ProgressRing({ percent }: { percent: number }) {
  const radius = 9
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - percent / 100)
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" className="-rotate-90 text-foreground">
      <circle cx="11" cy="11" r={radius} fill="none" stroke="currentColor" strokeOpacity={0.15} strokeWidth="2.5" />
      <circle
        cx="11"
        cy="11"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
      />
    </svg>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: SetupSteps, first run guide, .env setup steps,
 *   getting started without .env
 * WHAT:  The four steps from a fresh copy to a running app: create .env from
 *        .env.example, fill in the settings below, create the database
 *        tables, restart. Step one is highlighted while no .env file exists.
 * WHY:   Someone running the app for the first time (a buyer of a package)
 *        sees exactly what to do and in which order, instead of a list of
 *        variable names.
 */
function SetupSteps({ envFileFound }: { envFileFound: boolean }) {
  const steps = [
    { title: 'Create your settings file', detail: 'In the project folder, run:', command: 'cp .env.example .env', done: envFileFound },
    { title: 'Fill in the settings below', detail: 'Open .env in a text editor and set each value listed under “Required”.', command: null, done: false },
    { title: 'Create the database tables', detail: 'With DATABASE_URL set, run:', command: 'npx prisma migrate deploy', done: false },
    { title: 'Restart the app', detail: 'Stop it (Ctrl+C) and start it again. This page closes once everything is set.', command: 'npm run build && npm start', done: false },
  ]
  const current = steps.findIndex((s) => !s.done)
  return (
    <ol className="mb-6 space-y-3 rounded-2xl border bg-card p-4">
      {steps.map((s, i) => (
        <li key={s.title} className="flex gap-3">
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
              s.done ? 'bg-muted text-muted-foreground' : i === current ? 'bg-primary text-primary-foreground' : 'border text-muted-foreground'
            )}
          >
            {s.done ? <CheckIcon className="size-3.5" strokeWidth={2.5} /> : i + 1}
          </span>
          <div className="min-w-0 space-y-1">
            <p className={cn('text-sm font-medium', s.done && 'text-muted-foreground line-through')}>{s.title}</p>
            {!s.done ? <p className="text-xs text-muted-foreground">{s.detail}</p> : null}
            {!s.done && s.command ? <code className="block rounded-md bg-muted px-2 py-1 font-mono text-xs">{s.command}</code> : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

export function SetupChecklist({
  items,
  optional = [],
  envFileFound = true,
}: {
  items: EnvChecklistItem[]
  optional?: OptionalEnvItem[]
  /** Whether a .env file exists in the project folder (local installs). */
  envFileFound?: boolean
}) {
  const done = items.filter((item) => item.ok).length
  const total = items.length
  const percent = total === 0 ? 100 : Math.round((done / total) * 100)
  /* The first not-yet-configured row is the "next step" — lifted + highlighted. */
  const activeIndex = items.findIndex((item) => !item.ok)

  return (
    <main className="flex min-h-svh items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-center text-lg font-medium">Finish setup</h1>

        <p className="mb-4 text-center text-sm text-muted-foreground">A few settings are needed before the app can start.</p>
        <SetupSteps envFileFound={envFileFound} />

        <p className="mb-2 px-1 text-xs font-medium text-muted-foreground">Required</p>
        <div className="space-y-1 rounded-2xl border bg-card p-1.5">
          {items.map((item, index) => {
            const Icon = iconFor(item.icon)
            const isActive = index === activeIndex
            return (
              <div
                key={item.key}
                className={cn(
                  'relative flex items-center gap-3.5 rounded-xl px-4 py-3.5 transition-colors',
                  isActive && 'bg-accent'
                )}
              >
                <div
                  className={cn(
                    'flex size-9 shrink-0 items-center justify-center rounded-full',
                    isActive ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  )}
                >
                  <Icon className="size-[18px]" strokeWidth={2} />
                </div>

                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      item.ok ? 'text-muted-foreground' : 'text-foreground'
                    )}
                  >
                    {item.label}
                  </p>
                  {!item.ok ? (
                    <>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.help}</p>
                      <CtaLinks link={item.link} video={item.video} />
                    </>
                  ) : null}
                </div>

                {item.ok ? (
                  <CheckIcon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2.5} />
                ) : null}
              </div>
            )
          })}
        </div>

        <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ProgressRing percent={percent} />
          <span>
            {done} of {total} complete
          </span>
        </div>

        {optional.length > 0 ? (
          <div className="mt-8">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-xs font-medium text-muted-foreground">Optional integrations</p>
              <p className="text-xs text-muted-foreground">Not required to run the app</p>
            </div>
            <div className="space-y-1 rounded-2xl border border-dashed bg-card/50 p-1.5">
              {optional.map((item) => {
                const Icon = iconFor(item.icon)
                return (
                  <div key={item.id} className="flex items-start gap-3.5 rounded-xl px-4 py-3.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      <Icon className="size-[18px]" strokeWidth={2} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{item.label}</p>
                        <span
                          className={cn(
                            'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                            item.ok
                              ? 'bg-muted text-primary'
                              : 'bg-muted text-muted-foreground'
                          )}
                        >
                          {item.ok ? 'Configured' : 'Not set'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{item.purpose}</p>
                      {!item.ok ? (
                        <p className="mt-1.5 text-xs text-muted-foreground">{item.help}</p>
                      ) : null}

                      {/* Per-key status so a half-configured integration (e.g. keys set
                          but missing price IDs) reads honestly. */}
                      <ul className="mt-2 grid gap-1">
                        {item.keys.map((k) => (
                          <li key={k.key} className="flex items-center gap-1.5">
                            {k.ok ? (
                              <CheckIcon className="size-3 shrink-0 text-primary" strokeWidth={2.5} />
                            ) : (
                              <CircleIcon className="size-3 shrink-0 text-muted-foreground/50" strokeWidth={2} />
                            )}
                            <span
                              className={cn(
                                'text-[11px]',
                                k.ok ? 'text-muted-foreground' : 'text-foreground'
                              )}
                            >
                              {k.label}
                            </span>
                            {k.optional ? (
                              <span className="text-[10px] text-muted-foreground/70">· optional</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>

                      {!item.ok ? <CtaLinks link={item.link} video={item.video} /> : null}
                    </div>
                    {item.ok ? (
                      <CheckIcon className="size-4 shrink-0 text-muted-foreground" strokeWidth={2.5} />
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}
      </div>
    </main>
  )
}
