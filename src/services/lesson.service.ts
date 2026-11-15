import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: lessonService, findLessonForAgent,
 *   createLessonVersion, setCurrentLessonVersion, replaceVersionScenes,
 *   supersedeLessonExercises, supersedeLessonAssessments, findLessonPackage,
 *   findLatestLessonQaTask, listLessonsForQuality
 *
 * WHAT:  Pure Prisma for a lesson's package: versions, scenes, exercises,
 *        assessment items, and the reads that assemble them.
 * WHY:   Content is append-only (blueprint §36): a regenerated lesson adds a
 *        LessonVersion and moves currentVersionId; exercises and quiz items
 *        are superseded (supersededAt) rather than deleted. Scenes belong to a
 *        version, so replacing a script for the current version never touches
 *        an approved one. Every function takes a DbClient (router tx or the
 *        worker's persist tx) and is scoped to a course the caller verified.
 * WHERE: Lesson agents (src/lib/agents), lessons router, quality report.
 */

import { LessonStatus, type Prisma } from '@/generated/prisma'
import type { DbClient } from '@/lib/config'

// ── Agent context ────────────────────────────────────────────────────────

/** A lesson with its module and sibling titles — the writer's context. */
export function findLessonForAgent(db: DbClient, courseId: string, lessonId: string) {
  return db.lesson.findFirst({
    where: { id: lessonId, courseId },
    select: {
      id: true,
      title: true,
      position: true,
      kind: true,
      objectiveRefs: true,
      estimatedMinutes: true,
      currentVersionId: true,
      bookStartPage: true,
      bookEndPage: true,
      module: {
        select: {
          id: true,
          position: true,
          title: true,
          summary: true,
          bookChapterId: true,
          lessons: { orderBy: { position: 'asc' }, select: { id: true, title: true } },
        },
      },
    },
  })
}

export function findCurrentVersion(db: DbClient, lessonId: string) {
  return db.lesson.findUnique({
    where: { id: lessonId },
    select: { currentVersion: { select: { id: true, version: true, content: true } } },
  })
}

// ── Versions ─────────────────────────────────────────────────────────────

export async function createLessonVersion(
  db: DbClient,
  data: Omit<Prisma.LessonVersionUncheckedCreateInput, 'version'>
) {
  const latest = await db.lessonVersion.findFirst({
    where: { lessonId: data.lessonId },
    orderBy: { version: 'desc' },
    select: { version: true },
  })
  return db.lessonVersion.create({
    data: { ...data, version: (latest?.version ?? 0) + 1 },
    select: { id: true, version: true },
  })
}

export function setCurrentLessonVersion(db: DbClient, lessonId: string, versionId: string, status: LessonStatus) {
  return db.lesson.update({ where: { id: lessonId }, data: { currentVersionId: versionId, status }, select: { id: true } })
}

export function setLessonStatus(
  db: DbClient,
  lessonId: string,
  status: LessonStatus,
  approvedVersionId?: string | null
) {
  return db.lesson.update({
    where: { id: lessonId },
    data: { status, ...(approvedVersionId !== undefined ? { approvedVersionId } : {}) },
    select: { id: true },
  })
}

/**
 * SOURCE OF TRUTH KEYWORDS: settleUnfinishedLessons, stuck Generating, build
 *   cancelled, build failed, lesson status after job, LessonStatus.GENERATED
 * WHAT:  Moves a course's lessons still marked GENERATING to GENERATED.
 * WHY:   GENERATING is set when a lesson's script is written and cleared by
 *        QA. A build that is cancelled or fails before QA would leave the
 *        badge on "Generating…" forever; its written version is kept, so the
 *        lesson is ready to review (Resume build writes it again if needed).
 * WHERE: BUILD_COURSE onCancelled / onFailed (src/lib/generation/hooks.ts).
 */
export function settleUnfinishedLessons(db: DbClient, courseId: string) {
  return db.lesson.updateMany({
    where: { module: { courseId }, status: LessonStatus.GENERATING },
    data: { status: LessonStatus.GENERATED },
  })
}

// ── Scenes ───────────────────────────────────────────────────────────────

export async function replaceVersionScenes(
  db: DbClient,
  lessonVersionId: string,
  rows: Prisma.LessonSceneCreateManyInput[]
) {
  await db.lessonScene.deleteMany({ where: { lessonVersionId } })
  return db.lessonScene.createMany({ data: rows })
}

/** Rendered lecture MP4 for a version. */
export function updateVersionVideo(db: DbClient, versionId: string, videoAssetId: string) {
  return db.lessonVersion.update({ where: { id: versionId }, data: { videoAssetId }, select: { id: true } })
}

/** Everything the video renderer needs for one version. */
export function findVersionForVideo(db: DbClient, versionId: string) {
  return db.lessonVersion.findUnique({
    where: { id: versionId },
    select: {
      id: true,
      captionsAsset: { select: { storageKey: true } },
      scenes: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          durationMs: true,
          estimatedDurationMs: true,
          stillAsset: { select: { storageKey: true } },
          audioAsset: { select: { storageKey: true, mimeType: true } },
        },
      },
    },
  })
}

/** Narration result for a version: captions file + measured lecture length. */
export function updateVersionNarration(
  db: DbClient,
  versionId: string,
  data: { captionsAssetId: string; narrationDurationMs: number }
) {
  return db.lessonVersion.update({ where: { id: versionId }, data, select: { id: true } })
}

/** Links a scene to its rendered files (and stores a repaired diagram source). */
export function updateSceneVisuals(db: DbClient, sceneId: string, data: Prisma.LessonSceneUncheckedUpdateInput) {
  return db.lessonScene.update({ where: { id: sceneId }, data, select: { id: true } })
}

export function listVersionScenes(db: DbClient, lessonVersionId: string) {
  return db.lessonScene.findMany({
    where: { lessonVersionId },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      position: true,
      type: true,
      narration: true,
      onScreen: true,
      emphasis: true,
      pauseAfterMs: true,
      estimatedDurationMs: true,
      durationMs: true,
      stillAssetId: true,
      diagramAssetId: true,
      imageAssetId: true,
      visualError: true,
      audioAssetId: true,
    },
  })
}

// ── Exercises & assessments ──────────────────────────────────────────────

export async function supersedeLessonExercises(
  db: DbClient,
  lessonId: string,
  rows: Prisma.ExerciseCreateManyInput[]
) {
  await db.exercise.updateMany({ where: { lessonId, supersededAt: null }, data: { supersededAt: new Date() } })
  return db.exercise.createMany({ data: rows })
}

export async function supersedeLessonAssessments(
  db: DbClient,
  lessonId: string,
  rows: Prisma.AssessmentItemCreateManyInput[]
) {
  await db.assessmentItem.updateMany({ where: { lessonId, supersededAt: null }, data: { supersededAt: new Date() } })
  return db.assessmentItem.createMany({ data: rows })
}

export function listActiveExercises(db: DbClient, lessonId: string) {
  return db.exercise.findMany({
    where: { lessonId, supersededAt: null },
    orderBy: { position: 'asc' },
    select: { id: true, level: true, title: true, content: true },
  })
}

export function listActiveAssessments(db: DbClient, lessonId: string) {
  return db.assessmentItem.findMany({
    where: { lessonId, supersededAt: null },
    orderBy: { position: 'asc' },
    select: { id: true, objectiveRef: true, type: true, difficulty: true, content: true },
  })
}

// ── Reads for the lesson page ────────────────────────────────────────────

export function findLessonPackage(db: DbClient, courseId: string, lessonId: string) {
  return db.lesson.findFirst({
    where: { id: lessonId, courseId },
    select: {
      id: true,
      title: true,
      position: true,
      status: true,
      objectiveRefs: true,
      estimatedMinutes: true,
      currentVersionId: true,
      approvedVersionId: true,
      module: { select: { id: true, position: true, title: true } },
      currentVersion: {
        select: {
          id: true,
          version: true,
          content: true,
          source: true,
          createdAt: true,
          captionsAssetId: true,
          narrationDurationMs: true,
          videoAssetId: true,
          videoAsset: { select: { durationMs: true, bytes: true } },
        },
      },
    },
  })
}

/** The newest successful QA review of a lesson (its report is the task output). */
export function findLatestLessonQaTask(db: DbClient, courseId: string, lessonId: string) {
  return db.agentTask.findFirst({
    where: { key: `qa:${lessonId}`, status: 'SUCCEEDED', job: { courseId } },
    orderBy: { finishedAt: 'desc' },
    select: { output: true, finishedAt: true },
  })
}

// ── Quality report inputs ────────────────────────────────────────────────

export function listLessonsForQuality(db: DbClient, courseId: string) {
  return db.lesson.findMany({
    where: { courseId },
    select: {
      id: true,
      title: true,
      status: true,
      kind: true,
      objectiveRefs: true,
      currentVersionId: true,
      currentVersion: { select: { videoAssetId: true } },
      _count: {
        select: {
          exercises: { where: { supersededAt: null } },
          assessmentItems: { where: { supersededAt: null } },
        },
      },
    },
  })
}

export async function sumCurrentSceneDurations(db: DbClient, versionIds: readonly string[]) {
  if (versionIds.length === 0) {
    return new Map<string, { scenes: number; stills: number; narrated: number; estimatedMs: number; measuredMs: number }>()
  }
  const rows = await db.lessonScene.groupBy({
    by: ['lessonVersionId'],
    where: { lessonVersionId: { in: [...versionIds] } },
    _count: { _all: true, stillAssetId: true, audioAssetId: true },
    _sum: { estimatedDurationMs: true, durationMs: true },
  })
  return new Map(
    rows.map((r) => [
      r.lessonVersionId,
      {
        scenes: r._count._all,
        stills: r._count.stillAssetId,
        narrated: r._count.audioAssetId,
        estimatedMs: r._sum.estimatedDurationMs ?? 0,
        measuredMs: r._sum.durationMs ?? 0,
      },
    ])
  )
}

export function listAssessedObjectiveRefs(db: DbClient, courseId: string) {
  return db.assessmentItem
    .findMany({ where: { courseId, supersededAt: null }, distinct: ['objectiveRef'], select: { objectiveRef: true } })
    .then((rows) => rows.map((r) => r.objectiveRef))
}

// ── Section quizzes & final assessment ───────────────────────────────────
// Scope is positional: a section quiz item has moduleId set and lessonId
// null; a final-assessment item has both null. Same supersede rule as lesson
// items (old rows kept with supersededAt).

export async function supersedeModuleAssessments(
  db: DbClient,
  moduleId: string,
  rows: Prisma.AssessmentItemCreateManyInput[]
) {
  await db.assessmentItem.updateMany({
    where: { moduleId, lessonId: null, supersededAt: null },
    data: { supersededAt: new Date() },
  })
  return db.assessmentItem.createMany({ data: rows })
}

export async function supersedeFinalAssessments(
  db: DbClient,
  courseId: string,
  rows: Prisma.AssessmentItemCreateManyInput[]
) {
  await db.assessmentItem.updateMany({
    where: { courseId, moduleId: null, lessonId: null, supersededAt: null },
    data: { supersededAt: new Date() },
  })
  return db.assessmentItem.createMany({ data: rows })
}

const ITEM_SELECT = { id: true, objectiveRef: true, type: true, difficulty: true, content: true } as const

export function listSectionAssessments(db: DbClient, courseId: string) {
  return db.assessmentItem.findMany({
    where: { courseId, lessonId: null, moduleId: { not: null }, supersededAt: null },
    orderBy: { position: 'asc' },
    select: { ...ITEM_SELECT, moduleId: true },
  })
}

export function listFinalAssessments(db: DbClient, courseId: string) {
  return db.assessmentItem.findMany({
    where: { courseId, lessonId: null, moduleId: null, supersededAt: null },
    orderBy: { position: 'asc' },
    select: ITEM_SELECT,
  })
}

/** Current written content of lessons (optionally one module), in course order. */
export function listLessonContents(db: DbClient, courseId: string, moduleId?: string) {
  return db.lesson.findMany({
    where: { courseId, kind: 'STANDARD', currentVersionId: { not: null }, ...(moduleId ? { moduleId } : {}) },
    orderBy: [{ module: { position: 'asc' } }, { position: 'asc' }],
    select: {
      id: true,
      title: true,
      objectiveRefs: true,
      module: { select: { id: true, title: true, position: true } },
      currentVersion: { select: { content: true } },
    },
  })
}

/**
 * SOURCE OF TRUTH KEYWORDS: findBuildProgress, build progress, resume build
 *
 * WHAT:  What already exists for every lesson of a course (current version,
 *        scenes with visuals and narration, video, active exercises and quiz,
 *        QA outcome) plus course-level outputs, for resuming a stopped build.
 * WHERE: enqueueResumeBuild (src/lib/courses/build-course.ts).
 */
export async function findBuildProgress(db: DbClient, courseId: string) {
  const [lessons, sectionQuizModules, finalItems, course] = await Promise.all([
    db.lesson.findMany({
      where: { courseId },
      select: {
        id: true,
        status: true,
        currentVersion: {
          select: { videoAssetId: true, scenes: { select: { stillAssetId: true, audioAssetId: true } } },
        },
        _count: {
          select: {
            exercises: { where: { supersededAt: null } },
            assessmentItems: { where: { supersededAt: null } },
          },
        },
      },
    }),
    db.assessmentItem.groupBy({ by: ['moduleId'], where: { courseId, lessonId: null, moduleId: { not: null }, supersededAt: null } }),
    db.assessmentItem.count({ where: { courseId, lessonId: null, moduleId: null, supersededAt: null } }),
    db.course.findUnique({ where: { id: courseId }, select: { subtitle: true, finalProject: true, cheatSheet: true } }),
  ])
  return { lessons, sectionQuizModules: sectionQuizModules.map((row) => row.moduleId), finalItems, course }
}
