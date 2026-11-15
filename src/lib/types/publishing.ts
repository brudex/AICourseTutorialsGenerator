/**
 * SOURCE OF TRUTH KEYWORDS: publishing types, PublishingPlatform options,
 *   publicationOptionsSchema, PublicationOptions, publishCourseSchema,
 *   connectCanvasSchema, canvasAddressSchema, startConnectSchema,
 *   completeConnectSchema, connectStateSchema, CanvasOAuthCredentials,
 *   GoogleCredentials, CanvasCredentials, Publisher, PublishRunContext
 *
 * WHAT:  Every contract for publishing a course to an outside platform: the
 *        router inputs (connect, publish), the per-platform
 *        publish options, the decrypted credential shapes and the Publisher
 *        interface each platform implements.
 * WHY:   One discriminated union (on `platform`) types the options end to
 *        end, from the Publish dialog form to the worker, so a platform's
 *        options cannot reach another platform's publisher. Publisher is the
 *        plug-in point: a new platform is one file implementing it plus one
 *        PUBLISHING_PLATFORMS entry.
 * WHERE: src/trpc/routers/publishing.ts, src/lib/publishing/*, the
 *        coursePublisher agent, the Connections page and the Publish dialog.
 */

import { z } from 'zod'

import { PublishingPlatform } from '@/generated/prisma'
import type { CoursePackageInput } from './export'
import type { LoadedCourseSnapshot } from './course-sync'

const orgInput = { organizationId: z.string().min(1) }

/* ── Publish options, one shape per platform ────────────────────────────── */

export const YOUTUBE_PRIVACY_STATUSES = ['private', 'unlisted', 'public'] as const
export type YoutubePrivacyStatus = (typeof YOUTUBE_PRIVACY_STATUSES)[number]

export const youtubeOptionsSchema = z.object({
  platform: z.literal(PublishingPlatform.YOUTUBE),
  privacy: z.enum(YOUTUBE_PRIVACY_STATUSES),
  madeForKids: z.boolean(),
})

export const classroomOptionsSchema = z.object({
  platform: z.literal(PublishingPlatform.GOOGLE_CLASSROOM),
  className: z.string().trim().min(1, 'Name the class.').max(120),
  section: z.string().trim().max(120),
})

export const canvasOptionsSchema = z.object({
  platform: z.literal(PublishingPlatform.CANVAS),
  canvasCourseId: z.string().trim().min(1, 'Choose a Canvas course.'),
})

export const VIMEO_PRIVACY_VIEWS = ['anybody', 'unlisted', 'nobody'] as const
export type VimeoPrivacyView = (typeof VIMEO_PRIVACY_VIEWS)[number]

export const vimeoOptionsSchema = z.object({
  platform: z.literal(PublishingPlatform.VIMEO),
  privacy: z.enum(VIMEO_PRIVACY_VIEWS),
})

export const driveOptionsSchema = z.object({
  platform: z.literal(PublishingPlatform.GOOGLE_DRIVE),
  folderName: z.string().trim().min(1, 'Name the folder.').max(200),
})

export const LEARNDASH_STATUSES = ['publish', 'draft'] as const
export const learndashOptionsSchema = z.object({
  platform: z.literal(PublishingPlatform.LEARNDASH),
  status: z.enum(LEARNDASH_STATUSES),
})

/* Your own school on the hosted app: list it straight away, and for whom. */
export const schoolOptionsSchema = z.object({
  platform: z.literal(PublishingPlatform.SCHOOL),
  listInSchool: z.boolean(),
  openEnrollment: z.boolean(),
})

export const publicationOptionsSchema = z.discriminatedUnion('platform', [
  youtubeOptionsSchema,
  classroomOptionsSchema,
  canvasOptionsSchema,
  vimeoOptionsSchema,
  driveOptionsSchema,
  learndashOptionsSchema,
  schoolOptionsSchema,
])

export type PublicationOptions = z.infer<typeof publicationOptionsSchema>
export type PublicationOptionsFor<P extends PublishingPlatform> = Extract<PublicationOptions, { platform: P }>
export type YoutubeOptions = z.infer<typeof youtubeOptionsSchema>
export type ClassroomOptions = z.infer<typeof classroomOptionsSchema>
export type CanvasOptions = z.infer<typeof canvasOptionsSchema>
export type VimeoOptions = z.infer<typeof vimeoOptionsSchema>
export type DriveOptions = z.infer<typeof driveOptionsSchema>
export type LearndashOptions = z.infer<typeof learndashOptionsSchema>
export type SchoolPublishOptions = z.infer<typeof schoolOptionsSchema>

/* The Publish dialog's first step: which connection. */
export const chooseConnectionSchema = z.object({ connectionId: z.string().min(1, 'Choose where to publish.') })
export type ChooseConnectionValues = z.infer<typeof chooseConnectionSchema>

/* ── Router inputs ──────────────────────────────────────────────────────── */

export const publishCourseSchema = z.object({
  ...orgInput,
  courseId: z.string().min(1),
  connectionId: z.string().min(1, 'Choose where to publish.'),
  options: publicationOptionsSchema,
})
export type PublishCourseValues = z.infer<typeof publishCourseSchema>

/* A site address (Canvas school, WordPress site), normalised (no trailing slash). */
const siteBaseUrl = z
  .string()
  .trim()
  .url('Enter the full address, starting with https://')
  .transform((url) => url.replace(/\/+$/, ''))
const canvasBaseUrl = siteBaseUrl

/* Connect dialogs, step one: which site. */
export const siteAddressSchema = z.object({ baseUrl: siteBaseUrl })
export type SiteAddressValues = z.input<typeof siteAddressSchema>

/* Fallback for a school without a registered developer key. */
export const connectCanvasSchema = z.object({
  ...orgInput,
  baseUrl: canvasBaseUrl,
  token: z.string().trim().min(10, 'Paste the access token from Canvas.'),
})
export type ConnectCanvasValues = z.input<typeof connectCanvasSchema>

/* WordPress fallback: an application password pasted by hand (sites on http,
 * or when the approval page cannot send the user back). */
export const connectWordPressSchema = z.object({
  ...orgInput,
  baseUrl: siteBaseUrl,
  username: z.string().trim().min(1, 'Enter your WordPress username.'),
  appPassword: z.string().trim().min(16, 'Paste the application password WordPress showed you.'),
})
export type ConnectWordPressValues = z.input<typeof connectWordPressSchema>

/* Your school on the hosted app: its address and a school API key
 * (Students → API on that install). */
export const connectSchoolSchema = z.object({
  ...orgInput,
  baseUrl: siteBaseUrl,
  apiKey: z.string().trim().regex(/^acs_[A-Za-z0-9_-]{16,}$/, 'Paste the API key from Students → API in your hosted studio.'),
})
export type ConnectSchoolValues = z.input<typeof connectSchoolSchema>

/* Platforms connected through Google sign-in. */
export const GOOGLE_PUBLISHING_PLATFORMS = [
  PublishingPlatform.YOUTUBE,
  PublishingPlatform.GOOGLE_CLASSROOM,
  PublishingPlatform.GOOGLE_DRIVE,
] as const
export type GooglePublishingPlatform = (typeof GOOGLE_PUBLISHING_PLATFORMS)[number]

const platformSchema = z.enum(PublishingPlatform)

/* Start a sign-in connection. Canvas also needs the school's address. */
export const startConnectSchema = z.object({
  ...orgInput,
  platform: platformSchema,
  baseUrl: canvasBaseUrl.nullable(),
})

/* Finish it: the code the platform sent back (OAuth), or the application
 * password WordPress hands back after the user approves. */
export const completeConnectSchema = z.object({
  ...orgInput,
  platform: platformSchema,
  baseUrl: z.string().url().nullable(),
  code: z.string().min(1).nullable(),
  wordpress: z.object({ username: z.string().min(1), appPassword: z.string().min(1) }).nullable(),
})

/* Signed into the OAuth `state` so the callback knows who started it. */
export const connectStateSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  platform: platformSchema,
  baseUrl: z.string().url().nullable(),
  expiresAt: z.number().int(),
})
export type ConnectState = z.infer<typeof connectStateSchema>

export const publishingConnectionInputSchema = z.object({ ...orgInput, connectionId: z.string().min(1) })
export const coursePublicationsInputSchema = z.object({ ...orgInput, courseId: z.string().min(1) })

/* ── Stored credentials (decrypted server side only) ────────────────────── */

export const googleCredentialsSchema = z.object({
  kind: z.literal('google'),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  /** Epoch milliseconds. */
  expiresAt: z.number().int(),
  scope: z.string(),
})
export type GoogleCredentials = z.infer<typeof googleCredentialsSchema>

export const canvasCredentialsSchema = z.object({
  kind: z.literal('canvas'),
  token: z.string().min(1),
})
export type CanvasCredentials = z.infer<typeof canvasCredentialsSchema>

/* Canvas through the school's developer key (sign in with Canvas). */
export const canvasOAuthCredentialsSchema = z.object({
  kind: z.literal('canvas-oauth'),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  /** Epoch milliseconds. */
  expiresAt: z.number().int(),
})
export type CanvasOAuthCredentials = z.infer<typeof canvasOAuthCredentialsSchema>

/* Vimeo tokens do not expire. */
export const vimeoCredentialsSchema = z.object({ kind: z.literal('vimeo'), accessToken: z.string().min(1) })
export type VimeoCredentials = z.infer<typeof vimeoCredentialsSchema>

/* WordPress application password (Basic auth on the REST API). */
export const wordpressCredentialsSchema = z.object({
  kind: z.literal('wordpress'),
  username: z.string().min(1),
  appPassword: z.string().min(1),
})
export type WordPressCredentials = z.infer<typeof wordpressCredentialsSchema>

/* A school API key on the hosted app (Bearer auth on /api/v1). */
export const schoolCredentialsSchema = z.object({ kind: z.literal('school'), apiKey: z.string().min(1) })
export type SchoolCredentials = z.infer<typeof schoolCredentialsSchema>

export const publishingCredentialsSchema = z.discriminatedUnion('kind', [
  googleCredentialsSchema,
  canvasCredentialsSchema,
  canvasOAuthCredentialsSchema,
  vimeoCredentialsSchema,
  wordpressCredentialsSchema,
  schoolCredentialsSchema,
])
export type PublishingCredentials = z.infer<typeof publishingCredentialsSchema>

/* ── The Publisher plug-in contract ─────────────────────────────────────── */

/**
 * What a publisher gets for one run. `recall`/`remember` make runs
 * resumable: a publisher checks `recall(key)` before creating anything and
 * calls `remember` right after, so a retry skips what already exists.
 */
export interface PublishRunContext<P extends PublishingPlatform = PublishingPlatform> {
  input: CoursePackageInput
  options: PublicationOptionsFor<P>
  connection: { id: string; name: string; baseUrl: string | null }
  /**
   * The credential for the platform's API: a fresh bearer token (Google,
   * Canvas, Vimeo), or `user:applicationPassword` for WordPress Basic auth.
   */
  accessToken: () => Promise<string>
  read: (storageKey: string) => Promise<Uint8Array>
  recall: (key: string) => Promise<{ externalId: string; externalUrl: string | null } | null>
  remember: (key: string, externalId: string, externalUrl?: string | null) => Promise<void>
  /** Items finished so far (for the progress bar). */
  progress: (done: number) => Promise<void>
  /** Throws when the job was cancelled; call between uploads. */
  assertLive: () => Promise<void>
  /** The course as database rows and files, for copying to another install (your online school). */
  snapshot: () => Promise<LoadedCourseSnapshot>
  /** Items already published to YouTube for this course, for linking. */
  youtubeVideoFor: (lessonId: string) => Promise<string | null>
  log: (line: string) => void
}

export interface PublishResult {
  externalId: string
  externalUrl: string
}

export interface Publisher<P extends PublishingPlatform = PublishingPlatform> {
  platform: P
  /** How many steps the run has, for progress. */
  countItems: (input: CoursePackageInput) => number
  publish: (context: PublishRunContext<P>) => Promise<PublishResult>
}
