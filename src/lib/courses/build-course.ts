import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: enqueueBuildCourse, buildCourseTaskGraph,
 *   BUILD_COURSE DAG, lesson package generation
 *
 * WHAT:  Builds and enqueues the BUILD_COURSE job (after ensuring the course
 *        opens with a welcome lecture): for every lesson,
 *          lessonWriter → { videoDirector → { visualRenderer, narrator? } → videoRenderer,
 *                           exerciseDesigner?, assessmentDesigner? } → qaReviewer
 *        plus a section quiz per module, the final assessment and the final
 *        project (after all lessons), one courseLandingWriter task, and the
 *        downloads (cheatSheetWriter → materialsBuilder, after all content).
 *        Also builds the media-only RENDER_* jobs and BUILD_MATERIALS.
 * WHY:   One place defines the lesson-package pipeline, used by approval
 *        (blueprint §25: approve → generate) and by "Generate lessons".
 *        Exercise and quiz tasks follow the brief's includes. A model must be
 *        routed for Strong reasoning before anything is queued, so the user
 *        gets the reason immediately instead of a failed job.
 * WHERE: courses.approve and courses.generate (kind BUILD_COURSE).
 */

import { TRPCError } from '@trpc/server'

import { AiCapability, CourseStatus, JobKind } from '@/generated/prisma'
import type { DbClient } from '@/lib/config'
import { courseBriefSchema, type AgentTaskSpec, type CourseIncludes } from '@/lib/types'
import { AiGatewayError, hasRouteFor, resolveModelsForCall } from '@/lib/ai'
import { createGenerationJob } from '@/lib/generation'
import type { AgentId } from '@/lib/agents'
import * as courseService from '@/services/course.service'
import * as lessonService from '@/services/lesson.service'

function task(
  key: string,
  agentId: AgentId,
  dependsOn: string[],
  input: { courseId: string; lessonId?: string; moduleId?: string }
): AgentTaskSpec {
  return { key, agentId, dependsOn, input }
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildCourseTaskGraph
 *
 * WHAT:  Pure DAG builder for a course's lesson packages.
 */
export interface BuildGraphModule {
  id: string
  lessons: ReadonlyArray<{ id: string; kind: 'STANDARD' | 'WELCOME' }>
}

export function buildCourseTaskGraph(
  courseId: string,
  modules: readonly BuildGraphModule[],
  includes: CourseIncludes,
  options: { narrate: boolean }
): AgentTaskSpec[] {
  const tasks: AgentTaskSpec[] = [task('landing', 'courseLandingWriter', [], { courseId })]
  const allLessonWrites: string[] = []
  /* Every content task the downloads are built from. */
  const contentTasks: string[] = []

  for (const mod of modules) {
    const moduleLessonWrites: string[] = []
    for (const lesson of mod.lessons) {
      const lessonId = lesson.id
      const input = { courseId, lessonId }
      const write = `lesson:${lessonId}`
      const teaches = lesson.kind === 'STANDARD'
      const reviewDeps = [`scenes:${lessonId}`]
      tasks.push(task(write, 'lessonWriter', [], input))
      tasks.push(task(`scenes:${lessonId}`, 'videoDirector', [write], input))
      /* Visuals render from the script; QA reviews the script, not the pixels,
       * so it does not wait for rendering. */
      tasks.push(task(`visuals:${lessonId}`, 'visualRenderer', [`scenes:${lessonId}`], input))
      /* Narration is optional: queued only when a TTS model is routed. */
      if (options.narrate) tasks.push(task(`narration:${lessonId}`, 'narrator', [`scenes:${lessonId}`], input))
      /* The lecture MP4 needs the pictures (and the voice, when there is one). */
      tasks.push(
        task(
          `video:${lessonId}`,
          'videoRenderer',
          options.narrate ? [`visuals:${lessonId}`, `narration:${lessonId}`] : [`visuals:${lessonId}`],
          input
        )
      )
      /* The welcome lecture orients; it has no practice of its own. */
      if (teaches && includes.exercises) {
        tasks.push(task(`exercises:${lessonId}`, 'exerciseDesigner', [write], input))
        reviewDeps.push(`exercises:${lessonId}`)
      }
      if (teaches && includes.quizzes) {
        tasks.push(task(`quiz:${lessonId}`, 'assessmentDesigner', [write], input))
        reviewDeps.push(`quiz:${lessonId}`)
      }
      tasks.push(task(`qa:${lessonId}`, 'qaReviewer', reviewDeps, input))
      if (teaches) contentTasks.push(write, ...reviewDeps.filter((k) => !k.startsWith('scenes:')))
      if (teaches) {
        moduleLessonWrites.push(write)
        allLessonWrites.push(write)
      }
    }
    if (includes.quizzes && moduleLessonWrites.length > 0) {
      tasks.push(task(`sectionQuiz:${mod.id}`, 'sectionQuizDesigner', moduleLessonWrites, { courseId, moduleId: mod.id }))
      contentTasks.push(`sectionQuiz:${mod.id}`)
    }
  }

  if (includes.quizzes && allLessonWrites.length > 0) {
    tasks.push(task('finalAssessment', 'finalAssessmentDesigner', allLessonWrites, { courseId }))
    contentTasks.push('finalAssessment')
  }
  if (includes.projects && allLessonWrites.length > 0) {
    tasks.push(task('project', 'projectDesigner', allLessonWrites, { courseId }))
    contentTasks.push('project')
  }
  if (allLessonWrites.length > 0) {
    tasks.push(...materialTasks(courseId, allLessonWrites, contentTasks))
  }
  return tasks
}

/**
 * SOURCE OF TRUTH KEYWORDS: materialTasks, downloads DAG
 *
 * WHAT:  cheatSheetWriter (after the lessons) → materialsBuilder (after every
 *        content task), shared by BUILD_COURSE and BUILD_MATERIALS.
 */
function materialTasks(courseId: string, lessonDeps: readonly string[], contentDeps: readonly string[]): AgentTaskSpec[] {
  return [
    task('cheatSheet', 'cheatSheetWriter', [...lessonDeps], { courseId }),
    task('materials', 'materialsBuilder', [...new Set([...contentDeps, 'cheatSheet'])], { courseId }),
  ]
}

export async function enqueueBuildCourse(
  db: DbClient,
  params: { organizationId: string; courseId: string; createdById: string }
) {
  /* Every course opens with a welcome lecture (Introduction section). */
  await courseService.ensureWelcomeLesson(db, params.organizationId, params.courseId)
  const course = await courseService.findCourseWithCurriculum(db, params.organizationId, params.courseId)
  if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
  const brief = courseBriefSchema.safeParse(course.brief)
  if (!brief.success) throw new TRPCError({ code: 'BAD_REQUEST', message: 'The course brief is invalid. Edit it first.' })

  const lessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id))
  if (lessonIds.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'The curriculum has no lessons.' })

  try {
    await resolveModelsForCall(db, {
      organizationId: params.organizationId,
      capability: AiCapability.STRONG_REASONING,
      agentId: null,
    })
  } catch (error) {
    if (error instanceof AiGatewayError) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message })
    throw error
  }

  const job = await createGenerationJob(db, {
    organizationId: params.organizationId,
    courseId: course.id,
    createdById: params.createdById,
    kind: JobKind.BUILD_COURSE,
    scope: null,
    tasks: buildCourseTaskGraph(course.id, course.modules, brief.data.includes, {
      narrate: await hasRouteFor(db, params.organizationId, AiCapability.TTS),
    }),
  })
  await courseService.setCourseStatus(db, course.id, CourseStatus.GENERATING)
  return job
}

/**
 * SOURCE OF TRUTH KEYWORDS: pruneCompletedTasks, enqueueResumeBuild,
 *   resume build, continue stopped build, completedBuildKeys
 *
 * WHAT:  Continues a build that was cancelled or failed: the normal
 *        BUILD_COURSE graph minus every task whose output already exists
 *        (written lessons, scripts, rendered visuals, narration, videos,
 *        practice, QA verdicts, course-level content). Dependencies on removed
 *        tasks are dropped, since their output is already there. Downloads
 *        are always rebuilt so they include everything.
 * WHY:   Re-running the whole build rewrites lessons that were fine and pays
 *        for them again; resuming only does the missing work, e.g. narration
 *        and videos after a build was stopped early.
 * WHERE: courses.generate (kind RESUME_BUILD).
 */
export function pruneCompletedTasks(tasks: readonly AgentTaskSpec[], done: ReadonlySet<string>): AgentTaskSpec[] {
  const kept = tasks.filter((t) => !done.has(t.key))
  const keptKeys = new Set(kept.map((t) => t.key))
  return kept.map((t) => ({ ...t, dependsOn: t.dependsOn.filter((key) => keptKeys.has(key)) }))
}

function completedBuildKeys(progress: Awaited<ReturnType<typeof lessonService.findBuildProgress>>, narrate: boolean): Set<string> {
  const done = new Set<string>()
  for (const lesson of progress.lessons) {
    const version = lesson.currentVersion
    if (!version) continue
    done.add(`lesson:${lesson.id}`)
    const scenes = version.scenes
    if (scenes.length > 0) {
      done.add(`scenes:${lesson.id}`)
      if (scenes.every((s) => s.stillAssetId !== null)) done.add(`visuals:${lesson.id}`)
      if (scenes.every((s) => s.audioAssetId !== null)) done.add(`narration:${lesson.id}`)
      /* A silent video made before narration existed is re-rendered. */
      const narrationSettled = !narrate || done.has(`narration:${lesson.id}`)
      if (version.videoAssetId !== null && narrationSettled) done.add(`video:${lesson.id}`)
    }
    if (lesson._count.exercises > 0) done.add(`exercises:${lesson.id}`)
    if (lesson._count.assessmentItems > 0) done.add(`quiz:${lesson.id}`)
    if (lesson.status === 'APPROVED' || lesson.status === 'QA_FLAGGED') done.add(`qa:${lesson.id}`)
  }
  for (const moduleId of progress.sectionQuizModules) if (moduleId) done.add(`sectionQuiz:${moduleId}`)
  if (progress.finalItems > 0) done.add('finalAssessment')
  if (progress.course?.subtitle) done.add('landing')
  if (progress.course?.finalProject) done.add('project')
  if (progress.course?.cheatSheet) done.add('cheatSheet')
  return done
}

export async function enqueueResumeBuild(
  db: DbClient,
  params: { organizationId: string; courseId: string; createdById: string }
) {
  const course = await courseService.findCourseWithCurriculum(db, params.organizationId, params.courseId)
  if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
  const brief = courseBriefSchema.safeParse(course.brief)
  if (!brief.success) throw new TRPCError({ code: 'BAD_REQUEST', message: 'The course brief is invalid. Edit it first.' })
  try {
    await resolveModelsForCall(db, { organizationId: params.organizationId, capability: AiCapability.STRONG_REASONING, agentId: null })
  } catch (error) {
    if (error instanceof AiGatewayError) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: error.message })
    throw error
  }
  const narrate = await hasRouteFor(db, params.organizationId, AiCapability.TTS)
  const graph = buildCourseTaskGraph(course.id, course.modules, brief.data.includes, { narrate })
  const tasks = pruneCompletedTasks(graph, completedBuildKeys(await lessonService.findBuildProgress(db, course.id), narrate))
  if (tasks.every((t) => t.key === 'materials')) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Nothing is missing. Every lesson package is already built.' })
  }
  const job = await createGenerationJob(db, {
    organizationId: params.organizationId,
    courseId: course.id,
    createdById: params.createdById,
    kind: JobKind.BUILD_COURSE,
    scope: null,
    tasks,
  })
  await courseService.setCourseStatus(db, course.id, CourseStatus.GENERATING)
  return job
}

/**
 * SOURCE OF TRUTH KEYWORDS: enqueueRenderVisuals, RENDER_VISUALS
 *
 * WHAT:  Queues a visual-render task for every lesson that has a script —
 *        for courses built before visuals existed, or after slide-theme
 *        changes. No writing agents run, so it only costs a model call when a
 *        diagram needs repair.
 */
export async function enqueueRenderVisuals(
  db: DbClient,
  params: { organizationId: string; courseId: string; createdById: string }
) {
  const course = await courseService.findCourseWithCurriculum(db, params.organizationId, params.courseId)
  if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
  const lessonIds = course.modules.flatMap((m) => m.lessons.filter((l) => l.currentVersionId !== null).map((l) => l.id))
  if (lessonIds.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No lessons have been written yet.' })

  return createGenerationJob(db, {
    organizationId: params.organizationId,
    courseId: course.id,
    createdById: params.createdById,
    kind: JobKind.RENDER_VISUALS,
    scope: null,
    tasks: lessonIds.map((lessonId) => task(`visuals:${lessonId}`, 'visualRenderer', [], { courseId: course.id, lessonId })),
  })
}

/**
 * SOURCE OF TRUTH KEYWORDS: enqueueRenderNarration, RENDER_NARRATION
 *
 * WHAT:  Queues narration for every lesson with a script — after a voice
 *        change, or for courses built before a TTS model was connected.
 *        Refuses (with the reason) when no TTS model is routed.
 */
export async function enqueueRenderNarration(
  db: DbClient,
  params: { organizationId: string; courseId: string; createdById: string }
) {
  if (!(await hasRouteFor(db, params.organizationId, AiCapability.TTS))) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'Add a text-to-speech model and route Narration in Settings → AI Providers.',
    })
  }
  const course = await courseService.findCourseWithCurriculum(db, params.organizationId, params.courseId)
  if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
  const lessonIds = course.modules.flatMap((m) => m.lessons.filter((l) => l.currentVersionId !== null).map((l) => l.id))
  if (lessonIds.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No lessons have been written yet.' })

  return createGenerationJob(db, {
    organizationId: params.organizationId,
    courseId: course.id,
    createdById: params.createdById,
    kind: JobKind.RENDER_NARRATION,
    scope: null,
    tasks: lessonIds.map((lessonId) => task(`narration:${lessonId}`, 'narrator', [], { courseId: course.id, lessonId })),
  })
}

/**
 * SOURCE OF TRUTH KEYWORDS: enqueueRenderVideos, RENDER_VIDEO
 *
 * WHAT:  Re-renders the lecture MP4 of every written lesson from its current
 *        stills, narration, and captions (e.g. after a voice change).
 */
export async function enqueueRenderVideos(
  db: DbClient,
  params: { organizationId: string; courseId: string; createdById: string }
) {
  const course = await courseService.findCourseWithCurriculum(db, params.organizationId, params.courseId)
  if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
  const lessonIds = course.modules.flatMap((m) => m.lessons.filter((l) => l.currentVersionId !== null).map((l) => l.id))
  if (lessonIds.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No lessons have been written yet.' })

  return createGenerationJob(db, {
    organizationId: params.organizationId,
    courseId: course.id,
    createdById: params.createdById,
    kind: JobKind.RENDER_VIDEO,
    scope: null,
    tasks: lessonIds.map((lessonId) => task(`video:${lessonId}`, 'videoRenderer', [], { courseId: course.id, lessonId })),
  })
}

/**
 * SOURCE OF TRUTH KEYWORDS: enqueueBuildMaterials, BUILD_MATERIALS
 *
 * WHAT:  Rewrites the cheat sheet and rebuilds every download from the
 *        current course content (after edits, or for courses built before
 *        downloads existed). One model call (the cheat sheet); the rest is
 *        rendering.
 */
export async function enqueueBuildMaterials(
  db: DbClient,
  params: { organizationId: string; courseId: string; createdById: string }
) {
  const course = await courseService.findCourseWithCurriculum(db, params.organizationId, params.courseId)
  if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
  const written = course.modules.flatMap((m) => m.lessons.filter((l) => l.kind === 'STANDARD' && l.currentVersionId !== null))
  if (written.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No lessons have been written yet.' })

  return createGenerationJob(db, {
    organizationId: params.organizationId,
    courseId: course.id,
    createdById: params.createdById,
    kind: JobKind.BUILD_MATERIALS,
    scope: null,
    tasks: materialTasks(course.id, [], []),
  })
}

/**
 * SOURCE OF TRUTH KEYWORDS: enqueueExportCourse, enqueueExportScorm,
 *   EXPORT_COURSE, EXPORT_SCORM, export jobs
 *
 * WHAT:  Queues an export package job (one exporter task). No model call; it
 *        packages whatever is rendered and built so far.
 */
async function enqueueExport(
  db: DbClient,
  params: { organizationId: string; courseId: string; createdById: string },
  kind: typeof JobKind.EXPORT_COURSE | typeof JobKind.EXPORT_SCORM,
  agentId: AgentId
) {
  const course = await courseService.findCourseWithCurriculum(db, params.organizationId, params.courseId)
  if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
  const written = course.modules.flatMap((m) => m.lessons.filter((l) => l.kind === 'STANDARD' && l.currentVersionId !== null))
  if (written.length === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No lessons have been written yet.' })

  return createGenerationJob(db, {
    organizationId: params.organizationId,
    courseId: course.id,
    createdById: params.createdById,
    kind,
    scope: null,
    tasks: [task('export', agentId, [], { courseId: course.id })],
  })
}

export const enqueueExportCourse = (db: DbClient, params: { organizationId: string; courseId: string; createdById: string }) =>
  enqueueExport(db, params, JobKind.EXPORT_COURSE, 'courseExporter')

export const enqueueExportScorm = (db: DbClient, params: { organizationId: string; courseId: string; createdById: string }) =>
  enqueueExport(db, params, JobKind.EXPORT_SCORM, 'scormExporter')
