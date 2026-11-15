/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: PageContainer, PageContainerProps, PageContainerWidth,
 *   PAGE_CONTAINER_WIDTHS
 *
 * WHAT:  Barrel for the page content container.
 * WHY:   One import surface — `@/components/global/page-container`.
 * WHERE: Imported by ContentLayout and by pages that center content directly.
 */

export { PageContainer, PAGE_CONTAINER_WIDTHS } from './page-container'
export type { PageContainerProps, PageContainerWidth } from './page-container'
