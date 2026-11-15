/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: appRouter, AppRouter
 *
 * WHAT:  Root tRPC router that mounts every feature sub-router; `AppRouter` is
 *        the type exported for the client typed-hooks and the server proxy.
 * WHY:   Single composition point means new feature routers are wired by adding
 *        one line here; the type flows automatically to clients and the in-process proxy.
 * WHERE: Imported by src/trpc/server.tsx, src/trpc/react-provider.tsx, and
 *        src/app/api/trpc/[trpc]/route.ts. Mounts routers from src/trpc/routers/*.
 */

import { createTRPCRouter } from '../init'
import { organizationRouter } from './organization'
import { usageRouter } from './usage'
import { auditLogsRouter } from './audit-logs'
import { memberRouter } from './member'
import { invitationRouter } from './invitation'
import { organizationRolesRouter } from './organization-roles'
import { organizationSettingsRouter } from './organization-settings'
import { portalRouter } from './portal'
import { devRouter } from './dev'
import { userRouter } from './user'
import { aiProvidersRouter } from './ai-providers'
import { generationJobsRouter } from './generation-jobs'
import { coursesRouter } from './courses'
import { curriculumRouter } from './curriculum'
import { lessonsRouter } from './lessons'
import { courseBooksRouter } from './course-books'
import { dashboardRouter } from './dashboard'
import { publishingRouter } from './publishing'

/**
 * SOURCE OF TRUTH KEYWORDS: appRouter, AppRouter
 *
 * WHAT:  The composed root router and its inferred type.
 * WHY:   `AppRouter` is the single type clients use to derive end-to-end safety;
 *        every sub-router added below extends that public surface automatically.
 * WHERE: Consumed by the server proxy (src/trpc/server.tsx), the React hooks
 *        (src/trpc/react-provider.tsx), and the HTTP handler under src/app/api/trpc.
 */
export const appRouter = createTRPCRouter({
  organization: organizationRouter,
  usage: usageRouter,
  auditLogs: auditLogsRouter,
  member: memberRouter,
  invitation: invitationRouter,
  organizationRoles: organizationRolesRouter,
  organizationSettings: organizationSettingsRouter,
  portal: portalRouter,
  dev: devRouter,
  user: userRouter,
  aiProviders: aiProvidersRouter,
  generationJobs: generationJobsRouter,
  courses: coursesRouter,
  curriculum: curriculumRouter,
  lessons: lessonsRouter,
  courseBooks: courseBooksRouter,
  dashboard: dashboardRouter,
  publishing: publishingRouter,
})

export type AppRouter = typeof appRouter
