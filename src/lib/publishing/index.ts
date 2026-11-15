import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: publishing barrel, runPublication,
 *   enqueuePublishCourse, publishing helpers
 *
 * WHAT:  The publishing helpers the router, the OAuth callback and the worker
 *        use. The platform publishers are dispatched in run.ts (one switch on
 *        the Prisma enum, so a platform without a publisher fails to compile).
 * WHERE: coursePublisher agent, publishing router, OAuth callback route.
 */

export { runPublication } from './run'
export { enqueuePublishCourse } from './enqueue'
export { verifyCanvasToken, listCanvasTeacherCourses } from './canvas'
export {
  buildConnectUrl,
  completeConnection,
  saveWordPressConnection,
  saveSchoolConnection,
  signInAvailability,
  ConnectUnavailableError,
} from './connect'
export { connectionAccessToken } from './credentials'
export { readConnectState, publishingRedirectUri } from './state'
