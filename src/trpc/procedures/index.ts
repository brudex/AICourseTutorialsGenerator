/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: router, baseProcedure, authProcedure,
 *   protectedProcedure
 *
 * WHAT:  Barrel that re-exports the router builder and procedure factories
 *        from `./protected`.
 * WHY:   Lets src/trpc/init.ts (and anyone else) depend on `@/trpc/procedures`
 *        without reaching into the implementation file directly.
 * WHERE: Imported by src/trpc/init.ts; sourced from src/trpc/procedures/protected.ts.
 */

export {
  router,
  createCallerFactory,
  baseProcedure,
  authProcedure,
  protectedProcedure,
} from './protected'
