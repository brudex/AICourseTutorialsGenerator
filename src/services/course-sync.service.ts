import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: courseSyncService, readCourseSnapshotRows,
 *   findForeignSnapshotRows, applyCourseSnapshot, findSyncAsset, course sync
 *   database, publish to school rows
 *
 * WHAT:  Every database read and write for copying a course between installs:
 *        reading a course as snapshot rows (sender), checking that incoming
 *        ids do not belong to another workspace or course, writing the rows
 *        (receiver), and finding one synced file.
 * WHY:   Only the service layer touches the database. Rows keep their ids so
 *        a re-publish updates the same lecture and quiz records (students
 *        keep their progress); versions, scenes and downloads are replaced
 *        wholesale because nothing outside the course points at them. Call
 *        applyCourseSnapshot inside one transaction.
 * WHERE: src/lib/courses/course-snapshot.ts (sender) and
 *        src/lib/school/course-sync.ts (receiver).
 */

import { Prisma } from '@/generated/prisma'
import type { DbClient } from '@/lib/config'
import type { CourseSnapshot } from '@/lib/types'

// ── Sender: read a course ────────────────────────────────────────────────

export function readCourseSnapshotRows(db: DbClient, organizationId: string, courseId: string) {
  return db.course.findFirst({
    where: { id: courseId, organizationId },
    select: {
      id: true, title: true, slug: true, status: true, brief: true, goal: true, outcomes: true, prerequisites: true, assessmentStrategy: true,
      subtitle: true, description: true, whatYouWillLearn: true, requirements: true, targetAudience: true, finalProject: true, cheatSheet: true,
      modules: { orderBy: { position: 'asc' }, select: { id: true, position: true, title: true, summary: true, objectiveRefs: true, estimatedMinutes: true } },
      lessons: {
        orderBy: { position: 'asc' },
        select: {
          id: true, moduleId: true, position: true, title: true, objectiveRefs: true, estimatedMinutes: true, status: true, kind: true, currentVersionId: true,
          currentVersion: {
            select: {
              id: true, lessonId: true, version: true, content: true, source: true, captionsAssetId: true, narrationDurationMs: true, videoAssetId: true,
              scenes: {
                orderBy: { position: 'asc' },
                select: {
                  id: true, lessonId: true, lessonVersionId: true, position: true, type: true, narration: true, onScreen: true, emphasis: true, pauseAfterMs: true,
                  estimatedDurationMs: true, durationMs: true, stillAssetId: true, diagramAssetId: true, imageAssetId: true, audioAssetId: true,
                },
              },
            },
          },
        },
      },
      assessmentItems: { where: { supersededAt: null }, select: { id: true, moduleId: true, lessonId: true, objectiveRef: true, type: true, difficulty: true, position: true, content: true } },
      exercises: { where: { supersededAt: null }, select: { id: true, moduleId: true, lessonId: true, level: true, title: true, position: true, content: true } },
      materials: { select: { id: true, kind: true, audience: true, title: true, assetId: true } },
    },
  })
}

export function readSnapshotAssets(db: DbClient, organizationId: string, courseId: string, assetIds: readonly string[]) {
  return db.asset.findMany({
    where: { organizationId, courseId, id: { in: [...assetIds] } },
    select: { id: true, lessonId: true, kind: true, storageKey: true, mimeType: true, bytes: true, width: true, height: true, durationMs: true },
  })
}

// ── Receiver: guard, write, read back ────────────────────────────────────

/**
 * True when any incoming id already belongs to a different workspace or
 * course on this install. Ids are only ever updated where they already
 * belong, so one workspace can never overwrite another's records.
 */
export async function findForeignSnapshotRows(db: DbClient, organizationId: string, s: CourseSnapshot): Promise<boolean> {
  const courseId = s.course.id
  const foreign = { OR: [{ organizationId: { not: organizationId } }, { courseId: { not: courseId } }] }
  const ids = <T extends { id: string }>(rows: readonly T[]) => ({ in: rows.map((r) => r.id) })
  const counts = await Promise.all([
    db.course.count({ where: { id: courseId, organizationId: { not: organizationId } } }),
    db.module.count({ where: { id: ids(s.modules), ...foreign } }),
    db.lesson.count({ where: { id: ids(s.lessons), ...foreign } }),
    db.assessmentItem.count({ where: { id: ids(s.assessments), ...foreign } }),
    db.exercise.count({ where: { id: ids(s.exercises), ...foreign } }),
    db.asset.count({ where: { id: ids(s.assets), ...foreign } }),
    db.courseMaterial.count({ where: { id: ids(s.materials), ...foreign } }),
    db.lessonVersion.count({ where: { id: ids(s.versions), OR: [{ organizationId: { not: organizationId } }, { lesson: { courseId: { not: courseId } } }] } }),
    db.lessonScene.count({ where: { id: ids(s.scenes), OR: [{ organizationId: { not: organizationId } }, { lesson: { courseId: { not: courseId } } }] } }),
  ])
  return counts.some((n) => n > 0)
}

/* A free course slug in this workspace (another course may already use it). */
async function availableSlug(db: DbClient, organizationId: string, courseId: string, slug: string): Promise<string> {
  for (let n = 1; n < 50; n += 1) {
    const candidate = n === 1 ? slug : `${slug}-${n}`
    const taken = await db.course.findFirst({ where: { organizationId, slug: candidate, id: { not: courseId } }, select: { id: true } })
    if (!taken) return candidate
  }
  return `${slug}-${courseId.slice(-6)}`
}

const nullableJson = (value: Prisma.InputJsonValue | null) => value ?? Prisma.DbNull

/**
 * Writes the snapshot into the workspace. `storageKeyFor` turns a file's
 * course relative path into this install's storage key. Run inside one
 * transaction after findForeignSnapshotRows passed.
 */
export async function applyCourseSnapshot(db: DbClient, organizationId: string, s: CourseSnapshot, storageKeyFor: (path: string) => string) {
  const courseId = s.course.id
  const { id: _id, slug, outcomes, finalProject, cheatSheet, ...fields } = s.course
  const courseData = { ...fields, outcomes: nullableJson(outcomes), finalProject: nullableJson(finalProject), cheatSheet: nullableJson(cheatSheet), slug: await availableSlug(db, organizationId, courseId, slug) }
  await db.course.upsert({ where: { id: courseId }, create: { id: courseId, organizationId, ...courseData }, update: courseData, select: { id: true } })

  const keep = <T extends { id: string }>(rows: readonly T[]) => ({ notIn: rows.map((r) => r.id) })
  const lessonIds = s.lessons.map((l) => l.id)

  /* Versions, scenes and downloads are rebuilt; lectures first let go of their versions. */
  await db.lesson.updateMany({ where: { courseId, organizationId }, data: { currentVersionId: null, approvedVersionId: null } })
  await db.lessonVersion.deleteMany({ where: { organizationId, lesson: { courseId } } })
  await db.courseMaterial.deleteMany({ where: { organizationId, courseId } })

  /* Whatever the sender no longer has goes (cascades remove their children). */
  await db.assessmentItem.deleteMany({ where: { organizationId, courseId, id: keep(s.assessments) } })
  await db.exercise.deleteMany({ where: { organizationId, courseId, id: keep(s.exercises) } })
  await db.lesson.deleteMany({ where: { organizationId, courseId, id: keep(s.lessons) } })
  await db.module.deleteMany({ where: { organizationId, courseId, id: keep(s.modules) } })
  await db.asset.deleteMany({ where: { organizationId, courseId, id: keep(s.assets) } })

  for (const m of s.modules) {
    const { id, ...data } = m
    await db.module.upsert({ where: { id }, create: { id, organizationId, courseId, ...data }, update: data, select: { id: true } })
  }
  for (const l of s.lessons) {
    const { id, currentVersionId: _current, ...data } = l
    await db.lesson.upsert({ where: { id }, create: { id, organizationId, courseId, ...data }, update: data, select: { id: true } })
  }
  /* Files after lectures (a file may belong to a lecture), before versions and scenes (which use files). */
  for (const a of s.assets) {
    const { id, path, ...rest } = a
    const data = { ...rest, storageKey: storageKeyFor(path) }
    await db.asset.upsert({ where: { id }, create: { id, organizationId, courseId, ...data }, update: data, select: { id: true } })
  }
  if (s.versions.length) await db.lessonVersion.createMany({ data: s.versions.map((v) => ({ ...v, organizationId })) })
  if (s.scenes.length) await db.lessonScene.createMany({ data: s.scenes.map((sc) => ({ ...sc, organizationId })) })
  for (const l of s.lessons) {
    if (l.currentVersionId) await db.lesson.update({ where: { id: l.id }, data: { currentVersionId: l.currentVersionId, approvedVersionId: l.currentVersionId }, select: { id: true } })
  }
  for (const q of s.assessments) {
    const { id, ...data } = q
    await db.assessmentItem.upsert({ where: { id }, create: { id, organizationId, courseId, ...data }, update: data, select: { id: true } })
  }
  for (const e of s.exercises) {
    const { id, ...data } = e
    await db.exercise.upsert({ where: { id }, create: { id, organizationId, courseId, ...data }, update: data, select: { id: true } })
  }
  if (s.materials.length) await db.courseMaterial.createMany({ data: s.materials.map((m) => ({ ...m, organizationId, courseId })) })
  return { courseId, lessonIds }
}

export function listSyncAssets(db: DbClient, organizationId: string, courseId: string) {
  return db.asset.findMany({ where: { organizationId, courseId }, select: { id: true, storageKey: true } })
}

export function findSyncAsset(db: DbClient, organizationId: string, courseId: string, assetId: string) {
  return db.asset.findFirst({ where: { id: assetId, organizationId, courseId }, select: { id: true, storageKey: true, bytes: true, mimeType: true } })
}

export function courseExists(db: DbClient, organizationId: string, courseId: string) {
  return db.course.findFirst({ where: { id: courseId, organizationId }, select: { id: true } })
}
