/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: PageHeader, ContentLayout, PageHeading,
 *   PageContainer, width, page title, page description, page actions, back link
 *
 * WHAT:  The dashboard page chrome — a borderless header row (sidebar trigger,
 *        title, action slot) and a ContentLayout wrapper that stacks that
 *        header and the page content INSIDE one centered PageContainer.
 * WHY:   Every dashboard page renders the same header treatment; centralizing
 *        it here means a page is just `<ContentLayout title=... actions=...>`.
 *        The header lives inside the container (not above it) so the title,
 *        the actions, and the content below share ONE left edge — a full-bleed
 *        header over a capped body reads as two misaligned columns. No
 *        bottom border: the container's alignment already groups the page, so
 *        a rule across the top only chops the layout in half.
 *        The app is dark-only (forcedTheme in the root layout), so there is no
 *        theme toggle here.
 * WHERE: Used by pages under src/app/(dashboard)/** and (portal)/**. Pairs with
 *        the sidebar from src/components/global/sidebar.
 */

import * as React from 'react'
import Link from 'next/link'
import type { Route } from 'next'
import { ArrowLeftIcon } from 'lucide-react'

import { PageContainer } from '@/components/global/page-container'
import type { PageContainerWidth } from '@/components/global/page-container'
import { Separator } from '@/components/ui/separator'
import { OfflineBadge } from '@/components/global/connection-status'
import { SidebarTrigger } from '@/components/ui/sidebar'

export interface PageHeaderProps {
  title: string
}

/* The toolbar row: sidebar toggle and the page name. Page actions live in
 * PageHeading so every page puts them in the same place. */
export function PageHeader({ title }: PageHeaderProps) {
  return (
    /* No fixed height: the row is as tall as the trigger, and the vertical
       rhythm comes from the container's gap — a 4rem header inside an already
       padded container just stranded the title in whitespace. */
    <header className="flex shrink-0 items-center gap-2">
      {/* `-ml-1` pulls the icon's glyph onto the content's left edge — the
          button's own padding would otherwise indent it past the cards. */}
      <SidebarTrigger className="-ml-1" />
      {/* Height and centring come from Separator + the row's `items-center` —
          overriding either here is what knocked the rule out of alignment. */}
      <Separator orientation="vertical" className="mr-2" />
      <p className="truncate text-sm text-muted-foreground">{title}</p>
      {/* Shows only while there is no internet. */}
      <div className="ml-auto"><OfflineBadge /></div>
    </header>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: PageHeading, PageHeadingProps, ONE_PAGE_HEADING,
 *   page title block, back link, eyebrow, meta badges, header actions
 *
 * WHAT:  The one heading block every page uses: optional back link, optional
 *        eyebrow line, the title, a one line description, an optional meta row
 *        (badges, counts) and actions on the right.
 * WHY:   ONE_PAGE_HEADING — pages used to draw their own headings at different
 *        sizes and places (3xl here, xl there, actions in the toolbar on one
 *        page and beside the title on another). Static pages get it through
 *        ContentLayout; pages whose title comes from data (a course, a lesson)
 *        render it themselves with `heading={false}` on ContentLayout, so the
 *        look is identical either way.
 * WHERE: ContentLayout, DashboardHome, CourseWorkspace, LessonPackageView,
 *        CoursePlayer.
 */
/* Generic over the back link so dynamic routes (`/dashboard/courses/${id}`)
 * type check the same way they do on next/link. */
export interface PageHeadingProps<T extends string = string> {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  back?: { href: Route<T>; label: string }
  eyebrow?: React.ReactNode
  meta?: React.ReactNode
}

export function PageHeading<T extends string>({ title, description, actions, back, eyebrow, meta }: PageHeadingProps<T>) {
  return (
    <div className="space-y-3">
      {back ? (
        <Link href={back.href} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1.5">
          {eyebrow ? <p className="text-sm text-muted-foreground">{eyebrow}</p> : null}
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description ? <p className="max-w-3xl text-sm text-muted-foreground">{description}</p> : null}
          {meta ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-1 text-sm text-muted-foreground">{meta}</div>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}

export interface ContentLayoutProps {
  /** The page name, shown in the toolbar and (by default) as the heading. */
  title: string
  /** One line under the heading. */
  description?: string
  /** Buttons on the right of the heading. */
  actions?: React.ReactNode
  /**
   * false when the page renders its own PageHeading because the title comes
   * from data (a course, a lesson). The toolbar still shows `title`.
   */
  heading?: boolean
  /**
   * Max width of the centered content column — see PAGE_CONTAINER_WIDTHS.
   * Defaults to `'lg'` — the app-wide page width (APP_PAGE_WIDTH), so every
   * dashboard page shares one column. Pass `'full'` for content that needs
   * the whole page (wide tables, boards) so the opt-out stays explicit.
   */
  width?: PageContainerWidth
  children: React.ReactNode
}

export function ContentLayout({
  title,
  description,
  actions,
  heading = true,
  width = 'lg',
  children,
}: ContentLayoutProps) {
  return (
    /* Padding stays on the OUTER element and centering on the inner one: the
       gutter must survive on narrow screens where the container is already
       below its cap and `mx-auto` contributes nothing. */
    <div className="flex flex-1 flex-col p-4 md:p-6">
      <PageContainer width={width} className="gap-6">
        <PageHeader title={title} />
        {heading ? <PageHeading title={title} description={description} actions={actions} /> : null}
        {children}
      </PageContainer>
    </div>
  )
}
