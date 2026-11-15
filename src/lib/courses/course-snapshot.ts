import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: loadCourseSnapshot, course snapshot loader,
 *   publish to school sender, learner files only
 *
 * WHAT:  Reads one course as a CourseSnapshot for another install: the
 *        current version of every lecture with its scenes, active quizzes
 *        and exercises, learner downloads, and the files they use, each
 *        with its path inside the course folder.
 * WHY:   Students only need what the player shows, so instructor downloads
 *        (answer keys) never leave this install, and scene narration audio
 *        is only sent for lectures without a rendered video (the video
 *        already carries the voice).
 * WHERE: run.ts gives it to schoolPublisher as `snapshot()`.
 */

import type { DbClient } from '@/lib/config'
import { courseSnapshotSchema, type CourseSnapshot, type LoadedCourseSnapshot } from '@/lib/types'
import { courseStoragePrefix } from '@/lib/storage'
import * as courseSyncService from '@/services/course-sync.service'

export async function loadCourseSnapshot(db: DbClient, organizationId: string, courseId: string): Promise<LoadedCourseSnapshot> {
  const course = await courseSyncService.readCourseSnapshotRows(db, organizationId, courseId)
  if (!course) throw new Error('This course no longer exists.')

  const versions = course.lessons.flatMap((l) => (l.currentVersion ? [l.currentVersion] : []))
  const scenes = versions.flatMap((v) =>
    v.scenes.map((sc) => ({ ...sc, audioAssetId: v.videoAssetId ? null : sc.audioAssetId }))
  )
  const materials = course.materials.filter((m) => m.audience === 'LEARNER')

  const wanted = new Set<string>()
  const want = (id: string | null) => {
    if (id) wanted.add(id)
  }
  for (const v of versions) {
    want(v.videoAssetId)
    want(v.captionsAssetId)
  }
  for (const sc of scenes) [sc.stillAssetId, sc.diagramAssetId, sc.imageAssetId, sc.audioAssetId].forEach(want)
  for (const m of materials) want(m.assetId)

  const rows = await courseSyncService.readSnapshotAssets(db, organizationId, courseId, [...wanted])
  const found = new Set(rows.map((r) => r.id))
  /* A reference to a file that no longer exists is dropped, not sent. */
  const keepRef = (id: string | null) => (id && found.has(id) ? id : null)
  const prefix = courseStoragePrefix(organizationId, courseId)
  const storageKeys = new Map(rows.map((r) => [r.id, r.storageKey]))

  /* Parsed with the same schema the server uses, so a bad row fails here, not there. */
  const snapshot: CourseSnapshot = courseSnapshotSchema.parse({
    course: {
      id: course.id, title: course.title, slug: course.slug, status: course.status, brief: course.brief, goal: course.goal, outcomes: course.outcomes,
      prerequisites: course.prerequisites, assessmentStrategy: course.assessmentStrategy, subtitle: course.subtitle, description: course.description,
      whatYouWillLearn: course.whatYouWillLearn, requirements: course.requirements, targetAudience: course.targetAudience,
      finalProject: course.finalProject, cheatSheet: course.cheatSheet,
    },
    modules: course.modules,
    lessons: course.lessons.map(({ currentVersion, ...l }) => ({ ...l, currentVersionId: currentVersion?.id ?? null })),
    versions: versions.map(({ scenes: _scenes, ...v }) => ({ ...v, videoAssetId: keepRef(v.videoAssetId), captionsAssetId: keepRef(v.captionsAssetId) })),
    scenes: scenes.map((sc) => ({
      ...sc,
      stillAssetId: keepRef(sc.stillAssetId),
      diagramAssetId: keepRef(sc.diagramAssetId),
      imageAssetId: keepRef(sc.imageAssetId),
      audioAssetId: keepRef(sc.audioAssetId),
    })),
    assessments: course.assessmentItems,
    exercises: course.exercises,
    assets: rows.map(({ storageKey, ...a }) => ({
      ...a,
      path: storageKey.startsWith(prefix) ? storageKey.slice(prefix.length) : `files/${a.id}-${storageKey.split('/').pop() ?? 'file'}`,
    })),
    materials: materials.filter((m) => found.has(m.assetId)),
  })
  return { snapshot, storageKeys }
}
