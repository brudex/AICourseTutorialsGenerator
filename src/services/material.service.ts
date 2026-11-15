import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: materialService, CourseMaterial rows,
 *   listMaterialLessons, upsertMaterial, listMaterials, deleteMaterialsExcept,
 *   course downloads
 *
 * WHAT:  Pure Prisma for downloadable course materials: the lesson content
 *        they are built from, and the CourseMaterial rows that link each
 *        material kind to its stored file (Asset).
 * WHY:   One row per (course, kind): rebuilding replaces the file behind it
 *        instead of piling up copies. Removing a material deletes its Asset
 *        and the CourseMaterial row cascades with it.
 * WHERE: materialsBuilder agent (writes), courses.materials (reads),
 *        src/lib/courses/material-source.ts.
 */

import type { MaterialAudience, MaterialKind, Prisma } from '@/generated/prisma'
import type { DbClient } from '@/lib/config'

/** Written lessons with their active exercises and quiz, in course order. */
export function listMaterialLessons(db: DbClient, courseId: string) {
  return db.lesson.findMany({
    where: { courseId, kind: 'STANDARD', currentVersionId: { not: null } },
    orderBy: [{ module: { position: 'asc' } }, { position: 'asc' }],
    select: {
      id: true,
      title: true,
      module: { select: { title: true, position: true } },
      currentVersion: { select: { content: true } },
      exercises: {
        where: { supersededAt: null },
        orderBy: { position: 'asc' },
        select: { level: true, title: true, content: true },
      },
      assessmentItems: {
        where: { supersededAt: null },
        orderBy: { position: 'asc' },
        select: { content: true },
      },
    },
  })
}

export function upsertMaterial(db: DbClient, data: Prisma.CourseMaterialUncheckedCreateInput) {
  return db.courseMaterial.upsert({
    where: { courseId_kind: { courseId: data.courseId, kind: data.kind } },
    create: data,
    update: { audience: data.audience, title: data.title, assetId: data.assetId },
    select: { id: true },
  })
}

export function listMaterials(db: DbClient, courseId: string, audience: MaterialAudience | null) {
  return db.courseMaterial.findMany({
    where: { courseId, ...(audience ? { audience } : {}) },
    select: {
      id: true,
      kind: true,
      audience: true,
      title: true,
      assetId: true,
      updatedAt: true,
      asset: { select: { bytes: true, mimeType: true } },
    },
  })
}

/** Deletes materials (within `managed` kinds) whose content no longer exists; returns their storage keys. */
export async function deleteMaterialsExcept(
  db: DbClient,
  courseId: string,
  managed: readonly MaterialKind[],
  keep: readonly MaterialKind[]
) {
  const stale = await db.courseMaterial.findMany({
    where: { courseId, AND: [{ kind: { in: [...managed] } }, { kind: { notIn: [...keep] } }] },
    select: { assetId: true, asset: { select: { storageKey: true } } },
  })
  if (stale.length > 0) await db.asset.deleteMany({ where: { id: { in: stale.map((m) => m.assetId) } } })
  return stale.map((m) => m.asset.storageKey)
}

/**
 * SOURCE OF TRUTH KEYWORDS: listExportLectures, listMaterialFiles, course
 *   export reads
 *
 * WHAT:  Every lecture (welcome included) in course order with the stored
 *        files of its current version, and the stored files of built
 *        materials, for the course export package.
 */
/**
 * The rendered visuals of each lesson's current version, in scene order:
 * DIAGRAM scenes with their SVG and ILLUSTRATION scenes with their picture
 * (lecture notes and workbook figures).
 */
export function listLessonFigureScenes(db: DbClient, courseId: string) {
  return db.lesson.findMany({
    where: { courseId, currentVersionId: { not: null } },
    select: {
      id: true,
      currentVersion: {
        select: {
          scenes: {
            where: {
              OR: [
                { type: 'DIAGRAM', diagramAssetId: { not: null } },
                { type: 'ILLUSTRATION', imageAssetId: { not: null } },
              ],
            },
            orderBy: { position: 'asc' },
            select: {
              type: true,
              onScreen: true,
              diagramAsset: { select: { storageKey: true } },
              imageAsset: { select: { storageKey: true } },
            },
          },
        },
      },
    },
  })
}

export function listExportLectures(db: DbClient, courseId: string) {
  return db.lesson.findMany({
    where: { courseId },
    orderBy: [{ module: { position: 'asc' } }, { position: 'asc' }],
    select: {
      id: true,
      title: true,
      kind: true,
      estimatedMinutes: true,
      moduleId: true,
      currentVersion: {
        select: {
          content: true,
          videoAsset: { select: { storageKey: true, durationMs: true } },
          captionsAsset: { select: { storageKey: true } },
        },
      },
    },
  })
}

export function listMaterialFiles(db: DbClient, courseId: string, kinds: readonly MaterialKind[]) {
  return db.courseMaterial.findMany({
    where: { courseId, kind: { in: [...kinds] } },
    select: { kind: true, title: true, audience: true, asset: { select: { storageKey: true } } },
  })
}
