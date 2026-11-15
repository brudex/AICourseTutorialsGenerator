import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: createServerCaller, server-side tRPC caller,
 *   route handler procedure call
 *
 * WHAT:  A tRPC caller bound to the current request's context, for route
 *        handlers that must run a procedure (with its permission gate, audit
 *        row and transaction) outside the HTTP tRPC endpoint.
 * WHY:   The Google OAuth callback is a plain GET route Google redirects to;
 *        calling the procedure keeps "every important endpoint goes through
 *        protectedProcedure" true for it.
 * WHERE: src/app/api/publishing/google/callback/route.ts.
 */

import { createCallerFactory } from './procedures'
import { createTRPCContext } from './init'
import { appRouter } from './routers/_app'

const createCaller = createCallerFactory(appRouter)

export async function createServerCaller() {
  return createCaller(await createTRPCContext())
}
