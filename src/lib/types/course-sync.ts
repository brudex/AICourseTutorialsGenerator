/**
 * SOURCE OF TRUTH KEYWORDS: courseSnapshotSchema, CourseSnapshot, course
 *   sync, publish to school, snapshot rows, COURSE_SYNC_LIMITS,
 *   courseSyncResultSchema, schoolListingSchema, SchoolSyncInfo
 *
 * WHAT:  The contract for copying a finished course from one install (the
 *        desktop app) into a workspace's school on another (the hosted web
 *        app): every row the student player reads (course, sections,
 *        lectures, their current version and scenes, quizzes, exercises,
 *        downloads and the files behind them), the server's reply, and the
 *        listing choice.
 * WHY:   Both installs run the same code and schema, so rows travel with
 *        their own ids: retries and re-publishes update the same records and
 *        students keep their progress. The receiving server treats it as
 *        untrusted input: every field is validated here, cross references
 *        are checked (courseSnapshotReferenceErrors) and ids are checked
 *        against other workspaces before anything is written. Content blobs
 *        are JSON; the read side already validates them with its own
 *        schemas.
 * WHERE: Sent by schoolPublisher (src/lib/publishing/school.ts), received by
 *        /api/v1/course-sync (src/lib/school/course-sync.ts).
 */

import { z } from 'zod'

import {
  AssessmentDifficulty,
  AssessmentType,
  AssetKind,
  CourseStatus,
  ExerciseLevel,
  LessonKind,
  LessonStatus,
  MaterialAudience,
  MaterialKind,
  SceneType,
  VersionSource,
} from '@/generated/prisma'

export const COURSE_SYNC_LIMITS = {
  /** Rows per kind in one snapshot. */
  rows: 5000,
  /** One uploaded file (a lecture video is ~15 MB). */
  assetBytes: 100 * 1024 * 1024,
} as const

/* Any JSON except a bare null (a Json column holds an object or array). */
type JsonInput = Exclude<z.infer<ReturnType<typeof z.json>>, null>
const jsonValue = z.json().refine((value): value is JsonInput => value !== null, 'Expected JSON content.')

const id = z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/)
const text = (max: number) => z.string().max(max)
const many = <T extends z.ZodType>(item: T) => z.array(item).max(COURSE_SYNC_LIMITS.rows)
const strings = z.array(text(2000)).max(200)

/* A file's place inside the course folder, e.g. "lessons/abc/video.mp4". */
const assetPath = z
  .string()
  .min(1)
  .max(300)
  .regex(/^[A-Za-z0-9._/-]+$/)
  .refine((p) => !p.split('/').some((part) => part === '..' || part === '.' || part === ''), 'Invalid file path.')

export const courseSnapshotSchema = z.object({
  course: z.object({
    id,
    title: text(300).min(1),
    slug: text(200).min(1),
    status: z.enum(CourseStatus),
    brief: jsonValue,
    goal: text(4000).nullable(),
    outcomes: jsonValue.nullable(),
    prerequisites: strings,
    assessmentStrategy: text(8000).nullable(),
    subtitle: text(500).nullable(),
    description: text(20000).nullable(),
    whatYouWillLearn: strings,
    requirements: strings,
    targetAudience: strings,
    finalProject: jsonValue.nullable(),
    cheatSheet: jsonValue.nullable(),
  }),
  modules: many(z.object({ id, position: z.number().int(), title: text(300), summary: text(4000), objectiveRefs: strings, estimatedMinutes: z.number().int().min(0) })),
  lessons: many(z.object({
    id,
    moduleId: id,
    position: z.number().int(),
    title: text(300),
    objectiveRefs: strings,
    estimatedMinutes: z.number().int().min(0),
    status: z.enum(LessonStatus),
    kind: z.enum(LessonKind),
    currentVersionId: id.nullable(),
  })),
  versions: many(z.object({
    id,
    lessonId: id,
    version: z.number().int().min(1),
    content: jsonValue,
    source: z.enum(VersionSource),
    captionsAssetId: id.nullable(),
    narrationDurationMs: z.number().int().min(0).nullable(),
    videoAssetId: id.nullable(),
  })),
  scenes: many(z.object({
    id,
    lessonId: id,
    lessonVersionId: id,
    position: z.number().int(),
    type: z.enum(SceneType),
    narration: text(20000),
    onScreen: jsonValue,
    emphasis: strings,
    pauseAfterMs: z.number().int().min(0),
    estimatedDurationMs: z.number().int().min(0),
    durationMs: z.number().int().min(0).nullable(),
    stillAssetId: id.nullable(),
    diagramAssetId: id.nullable(),
    imageAssetId: id.nullable(),
    audioAssetId: id.nullable(),
  })),
  assessments: many(z.object({
    id,
    moduleId: id.nullable(),
    lessonId: id.nullable(),
    objectiveRef: text(100),
    type: z.enum(AssessmentType),
    difficulty: z.enum(AssessmentDifficulty),
    position: z.number().int(),
    content: jsonValue,
  })),
  exercises: many(z.object({
    id,
    moduleId: id.nullable(),
    lessonId: id.nullable(),
    level: z.enum(ExerciseLevel),
    title: text(300),
    position: z.number().int(),
    content: jsonValue,
  })),
  assets: many(z.object({
    id,
    lessonId: id.nullable(),
    kind: z.enum(AssetKind),
    path: assetPath,
    mimeType: text(120).min(1),
    bytes: z.number().int().min(0).max(COURSE_SYNC_LIMITS.assetBytes),
    width: z.number().int().nullable(),
    height: z.number().int().nullable(),
    durationMs: z.number().int().nullable(),
  })),
  materials: many(z.object({ id, kind: z.enum(MaterialKind), audience: z.enum(MaterialAudience), title: text(300), assetId: id })),
})
export type CourseSnapshot = z.infer<typeof courseSnapshotSchema>
export type CourseSnapshotAsset = CourseSnapshot['assets'][number]

/**
 * Every reference inside a snapshot must point at a row in the same
 * snapshot (a lecture's section, a scene's version, a file id), so the
 * server never links to rows it was not sent. Returns readable problems.
 */
export function courseSnapshotReferenceErrors(s: CourseSnapshot): string[] {
  const problems: string[] = []
  const modules = new Set(s.modules.map((m) => m.id))
  const lessons = new Set(s.lessons.map((l) => l.id))
  const versions = new Map(s.versions.map((v) => [v.id, v.lessonId]))
  const assets = new Set(s.assets.map((a) => a.id))
  const check = (ok: boolean, what: string) => {
    if (!ok && problems.length < 20) problems.push(what)
  }
  const asset = (ref: string | null, where: string) => check(ref === null || assets.has(ref), `${where} points at a file that was not sent.`)
  for (const l of s.lessons) {
    check(modules.has(l.moduleId), `Lecture "${l.title}" points at a missing section.`)
    check(l.currentVersionId === null || versions.get(l.currentVersionId) === l.id, `Lecture "${l.title}" points at a missing version.`)
  }
  for (const v of s.versions) {
    check(lessons.has(v.lessonId), 'A lecture version points at a missing lecture.')
    asset(v.videoAssetId, 'A lecture video')
    asset(v.captionsAssetId, 'Lecture captions')
  }
  for (const sc of s.scenes) {
    check(versions.get(sc.lessonVersionId) === sc.lessonId, 'A scene points at a missing lecture version.')
    for (const ref of [sc.stillAssetId, sc.diagramAssetId, sc.imageAssetId, sc.audioAssetId]) asset(ref, 'A scene')
  }
  for (const row of [...s.assessments, ...s.exercises]) {
    check(row.moduleId === null || modules.has(row.moduleId), 'A quiz or exercise points at a missing section.')
    check(row.lessonId === null || lessons.has(row.lessonId), 'A quiz or exercise points at a missing lecture.')
  }
  for (const a of s.assets) check(a.lessonId === null || lessons.has(a.lessonId), 'A file points at a missing lecture.')
  for (const m of s.materials) asset(m.assetId, `Download "${m.title}"`)
  const paths = new Set<string>()
  for (const a of s.assets) {
    check(!paths.has(a.path), 'Two files share the same path.')
    paths.add(a.path)
  }
  return problems
}

/* The server's answer to a snapshot: which files it still needs. */
export const courseSyncResultSchema = z.object({ courseId: z.string(), uploads: z.array(z.string()) })
export type CourseSyncResult = z.infer<typeof courseSyncResultSchema>

/* Listing the synced course in the school (last step of a publish). */
export const schoolListingSchema = z.object({ listed: z.boolean(), openEnrollment: z.boolean() })
export type SchoolListingValues = z.infer<typeof schoolListingSchema>
export const schoolListingResultSchema = z.object({ url: z.string().url() })

/* GET /api/v1/school: what a key unlocks, shown when connecting. */
export const schoolSyncInfoSchema = z.object({ name: z.string(), url: z.string().url() })
export type SchoolSyncInfo = z.infer<typeof schoolSyncInfoSchema>

/* The sender's view: the snapshot plus where each file lives locally. */
export interface LoadedCourseSnapshot {
  snapshot: CourseSnapshot
  /** Asset id → this install's storage key, for uploading the bytes. */
  storageKeys: ReadonlyMap<string, string>
}
