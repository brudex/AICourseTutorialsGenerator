import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: loadLessonView, lesson view, lesson package
 *   read model, scenes, notes, exercises, quiz, asset URLs
 *
 * WHAT:  Reads one lesson's learner-facing package: lesson info, current
 *        version with video and caption URLs, notes, scene script with media
 *        URLs, exercises and quiz, each Json column re-validated on the way out.
 * WHY:   The studio lesson page and the learner preview player must show
 *        exactly the same lesson, so they share this one read model. Media
 *        is referenced through /api/assets, which checks membership.
 *        Studio-only data (QA review) is added by the router, never here.
 *        `assetHref` builds media links: studio pages use /api/assets
 *        (membership checked), the school passes its own route that checks
 *        the student's enrollment.
 * WHERE: lessons.get, learner.lesson.
 */

import type { DbClient } from '@/lib/config'
import { assessmentItemContentSchema, exerciseContentSchema, lessonContentSchema, sceneSchema } from '@/lib/types'
import * as lessonService from '@/services/lesson.service'

const studioAssetHref = (assetId: string) => `/api/assets/${assetId}`

export async function loadLessonView(
  db: DbClient,
  courseId: string,
  lessonId: string,
  assetHref: (assetId: string) => string = studioAssetHref
) {
  const assetUrl = (assetId: string | null) => (assetId ? assetHref(assetId) : null)
  const lesson = await lessonService.findLessonPackage(db, courseId, lessonId)
  if (!lesson) return null
  const version = lesson.currentVersion
  const [sceneRows, exerciseRows, quizRows] = await Promise.all([
    version ? lessonService.listVersionScenes(db, version.id) : Promise.resolve([]),
    lessonService.listActiveExercises(db, lesson.id),
    lessonService.listActiveAssessments(db, lesson.id),
  ])

  const content = version ? lessonContentSchema.safeParse(version.content) : null
  const scenes = sceneRows.flatMap((row) => {
    const parsed = sceneSchema.safeParse({
      type: row.type,
      narration: row.narration,
      emphasis: row.emphasis,
      pauseAfterMs: row.pauseAfterMs,
      onScreen: row.onScreen,
    })
    return parsed.success
      ? [
          {
            id: row.id,
            position: row.position,
            estimatedDurationMs: row.estimatedDurationMs,
            durationMs: row.durationMs,
            stillUrl: assetUrl(row.stillAssetId),
            diagramUrl: assetUrl(row.diagramAssetId),
            imageUrl: assetUrl(row.imageAssetId),
            audioUrl: assetUrl(row.audioAssetId),
            visualError: row.visualError,
            scene: parsed.data,
          },
        ]
      : []
  })

  return {
    lesson: {
      id: lesson.id,
      title: lesson.title,
      position: lesson.position,
      status: lesson.status,
      objectiveRefs: lesson.objectiveRefs,
      estimatedMinutes: lesson.estimatedMinutes,
      module: lesson.module,
      isApprovedVersion: version !== null && lesson.approvedVersionId === version.id,
    },
    version: version
      ? {
          id: version.id,
          number: version.version,
          source: version.source,
          createdAt: version.createdAt,
          captionsUrl: assetUrl(version.captionsAssetId),
          narrationDurationMs: version.narrationDurationMs,
          videoUrl: assetUrl(version.videoAssetId),
          videoDurationMs: version.videoAsset?.durationMs ?? null,
          videoBytes: version.videoAsset?.bytes ?? null,
        }
      : null,
    notes: content?.success ? content.data : null,
    scenes,
    /* Measured narration lengths when every scene is voiced, else estimates. */
    estimatedVideoMs: scenes.reduce((sum, s) => sum + (s.durationMs ?? s.estimatedDurationMs), 0),
    videoLengthMeasured: scenes.length > 0 && scenes.every((s) => s.durationMs !== null),
    exercises: exerciseRows.flatMap((row) => {
      const parsed = exerciseContentSchema.safeParse(row.content)
      return parsed.success ? [{ id: row.id, level: row.level, title: row.title, content: parsed.data }] : []
    }),
    quiz: quizRows.flatMap((row) => {
      const parsed = assessmentItemContentSchema.safeParse(row.content)
      return parsed.success ? [{ id: row.id, objectiveRef: row.objectiveRef, difficulty: row.difficulty, content: parsed.data }] : []
    }),
  }
}
