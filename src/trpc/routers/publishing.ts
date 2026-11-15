/**
 * SOURCE OF TRUTH KEYWORDS: publishingRouter, publishing.getSetup,
 *   publishing.connectUrl, publishing.completeConnect,
 *   publishing.connectCanvas, publishing.connectWordPress, publishing.connectSchool, publishing.disconnect, publishing.canvasCourses,
 *   publishing.publications, publishing.publish
 *
 * WHAT:  Connections to outside platforms and publishing courses to them.
 * WHY:   Every procedure runs on protectedProcedure under the `publishing`
 *        resource, so permissions, audit rows and transactions are handled
 *        there. Customers never handle keys: connecting is a sign-in through
 *        the operator's OAuth apps (src/lib/publishing/apps.ts). Credentials
 *        are encrypted before they are stored and never returned. Procedures
 *        that call a platform get a longer transaction timeout because they
 *        wait on the network inside the mutation; the uploads always run in
 *        the worker (publishing.publish queues them).
 * WHERE: Connections settings page, course Publish dialog, and the OAuth
 *        callback route (via createServerCaller).
 */

import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { createTRPCRouter } from '../init'
import { protectedProcedure } from '../procedures'
import { PublishingPlatform } from '@/generated/prisma'
import { isOfferedPublishingPlatform } from '@/lib/config/publishing'
import { permissions } from '@/lib/permissions'
import {
  completeConnectSchema,
  connectCanvasSchema,
  connectWordPressSchema,
  connectSchoolSchema,
  coursePublicationsInputSchema,
  publishCourseSchema,
  publishingConnectionInputSchema,
  startConnectSchema,
  type CanvasCredentials,
} from '@/lib/types'
import { encryptApiKey } from '@/lib/ai'
import {
  buildConnectUrl,
  completeConnection,
  connectionAccessToken,
  ConnectUnavailableError,
  enqueuePublishCourse,
  listCanvasTeacherCourses,
  saveWordPressConnection,
  saveSchoolConnection,
  signInAvailability,
  verifyCanvasToken,
} from '@/lib/publishing'
import * as generationService from '@/services/generation.service'
import * as publishingService from '@/services/publishing.service'

/* Platform availability problems are the user's to read, not a server error. */
function rethrowUnavailable(error: unknown): never {
  if (error instanceof ConnectUnavailableError) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message })
  throw error
}

/* A package may offer fewer platforms; refuse the rest even if called directly. */
function assertOffered(platform: PublishingPlatform): void {
  if (!isOfferedPublishingPlatform(platform)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This platform is not available in this app.' })
  }
}

const orgInput = z.object({ organizationId: z.string().min(1) })
/* Network calls inside a mutation need more than the 10s default. */
const NETWORK_TX_TIMEOUT_MS = 45_000

export const publishingRouter = createTRPCRouter({
  /* Everything the Connections page shows. */
  getSetup: protectedProcedure({ requirePermission: permissions.PUBLISHING_READ })
    .input(orgInput)
    .query(async ({ ctx, input }) => ({
      signIn: signInAvailability(),
      connections: await publishingService.listConnections(ctx.db, input.organizationId),
    })),

  /* Where to send the browser to sign in. Null: this Canvas school has no
   * one-click sign-in, so the UI offers the access-token fallback. */
  connectUrl: protectedProcedure({ requirePermission: permissions.PUBLISHING_CREATE })
    .input(startConnectSchema)
    .query(({ ctx, input }) => {
      assertOffered(input.platform)
      try {
        return {
          url: buildConnectUrl({ organizationId: input.organizationId, userId: ctx.user.id, platform: input.platform, baseUrl: input.baseUrl }),
        }
      } catch (error) {
        rethrowUnavailable(error)
      }
    }),

  /* Called by the OAuth callback route after it verified the signed state. */
  completeConnect: protectedProcedure({ requirePermission: permissions.PUBLISHING_CREATE, txTimeout: NETWORK_TX_TIMEOUT_MS })
    .input(completeConnectSchema)
    .mutation(async ({ ctx, input }) => {
      try {
        return await completeConnection(ctx.db, { ...input, userId: ctx.user.id })
      } catch (error) {
        rethrowUnavailable(error)
      }
    }),

  /* WordPress without the redirect (app on http): the password pasted by hand. */
  connectWordPress: protectedProcedure({ requirePermission: permissions.PUBLISHING_CREATE, txTimeout: NETWORK_TX_TIMEOUT_MS })
    .input(connectWordPressSchema)
    .mutation(async ({ ctx, input }) => {
      assertOffered(PublishingPlatform.LEARNDASH)
      return saveWordPressConnection(ctx.db, { ...input, userId: ctx.user.id }).catch((error: Error) => {
        console.error('[publishing] WordPress connect failed', error)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Could not connect to this WordPress site. ${error.message || 'Check the address, username and password.'}`,
        })
      })
    }),

  /* Your online school: a hosted install's address and a school API key. */
  connectSchool: protectedProcedure({ requirePermission: permissions.PUBLISHING_CREATE, txTimeout: NETWORK_TX_TIMEOUT_MS })
    .input(connectSchoolSchema)
    .mutation(async ({ ctx, input }) => {
      assertOffered(PublishingPlatform.SCHOOL)
      return saveSchoolConnection(ctx.db, { ...input, userId: ctx.user.id }).catch((error: Error) => {
        console.error('[publishing] school connect failed', error)
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Could not connect to this school. ${error.message || 'Check the address and the API key.'}`,
        })
      })
    }),

  connectCanvas: protectedProcedure({ requirePermission: permissions.PUBLISHING_CREATE, txTimeout: NETWORK_TX_TIMEOUT_MS })
    .input(connectCanvasSchema)
    .mutation(async ({ ctx, input }) => {
      assertOffered(PublishingPlatform.CANVAS)
      const user = await verifyCanvasToken(input.baseUrl, input.token).catch((error: Error) => {
        throw new TRPCError({ code: 'BAD_REQUEST', message: `Could not connect with this address and token. ${error.message}` })
      })
      const credentials: CanvasCredentials = { kind: 'canvas', token: input.token }
      return publishingService.saveConnection(ctx.db, {
        organizationId: input.organizationId,
        platform: PublishingPlatform.CANVAS,
        name: `${new URL(input.baseUrl).host} (${user.name})`,
        accountId: user.id,
        baseUrl: input.baseUrl,
        credentialsCiphertext: encryptApiKey(JSON.stringify(credentials)),
        createdById: ctx.user.id,
      })
    }),

  disconnect: protectedProcedure({ requirePermission: permissions.PUBLISHING_DELETE })
    .input(publishingConnectionInputSchema)
    .mutation(async ({ ctx, input }) => {
      const removed = await publishingService.deleteConnection(ctx.db, input.organizationId, input.connectionId)
      if (removed.count === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'That connection no longer exists.' })
      return { id: input.connectionId }
    }),

  /* The Canvas courses this connection teaches, for the Publish dialog. */
  canvasCourses: protectedProcedure({ requirePermission: permissions.PUBLISHING_READ })
    .input(publishingConnectionInputSchema)
    .query(async ({ ctx, input }) => {
      const connection = await publishingService.findConnectionWithCredentials(ctx.db, input.organizationId, input.connectionId)
      if (!connection || connection.platform !== PublishingPlatform.CANVAS || !connection.baseUrl) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Canvas connection not found.' })
      }
      const token = await connectionAccessToken(ctx.db, connection)()
      return listCanvasTeacherCourses(connection.baseUrl, token).catch((error: Error) => {
        throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
      })
    }),

  publications: protectedProcedure({ requirePermission: permissions.PUBLISHING_READ })
    .input(coursePublicationsInputSchema)
    .query(async ({ ctx, input }) => publishingService.listCoursePublications(ctx.db, input.organizationId, input.courseId)),

  publish: protectedProcedure({ requirePermission: permissions.PUBLISHING_CREATE })
    .input(publishCourseSchema)
    .mutation(async ({ ctx, input }) => {
      if (await generationService.hasLiveCourseJob(ctx.db, input.courseId)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Wait for the running job on this course to finish, then publish.' })
      }
      return enqueuePublishCourse(ctx.db, {
        organizationId: input.organizationId,
        courseId: input.courseId,
        connectionId: input.connectionId,
        createdById: ctx.user.id,
        options: input.options,
      })
    }),
})
