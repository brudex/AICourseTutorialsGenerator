import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: computeCourseQualityReport, CourseQualityReport,
 *   course readiness checks, outcome coverage
 *
 * WHAT:  Deterministic readiness checks against the Udemy-style quality bar
 *        (docs/11 §1), counted straight from Course State — no model call.
 * WHY:   Coverage questions ("is every outcome assessed?", "does every
 *        lecture have practice?") have exact answers; asking a model would
 *        add cost and the chance of a wrong answer. Video length uses scene
 *        estimates until narration audio exists (step 7), and says so.
 * WHERE: BUILD_COURSE onSucceeded hook (src/lib/generation/hooks.ts);
 *        stored on Course.qualityReport and shown in the course workspace.
 */

import { LessonStatus, type MaterialKind } from '@/generated/prisma'
import type { DbClient } from '@/lib/config'
import {
  COURSE_QUALITY_MINIMUMS,
  courseBriefSchema,
  learningOutcomeSchema,
  type CourseQualityReport,
  type QualityCheck,
} from '@/lib/types'
import * as courseService from '@/services/course.service'
import * as lessonService from '@/services/lesson.service'
import * as materialService from '@/services/material.service'

export async function computeCourseQualityReport(
  db: DbClient,
  organizationId: string,
  courseId: string
): Promise<CourseQualityReport> {
  const course = await courseService.findCourse(db, organizationId, courseId)
  const lessons = await lessonService.listLessonsForQuality(db, courseId)
  const versionIds = lessons.map((l) => l.currentVersionId).filter((id): id is string => id !== null)
  const includes = courseBriefSchema.safeParse(course?.brief)
  const [durations, assessedRefs, finalItems, materials] = await Promise.all([
    lessonService.sumCurrentSceneDurations(db, versionIds),
    lessonService.listAssessedObjectiveRefs(db, courseId),
    lessonService.listFinalAssessments(db, courseId),
    materialService.listMaterials(db, courseId, null),
  ])
  const hasMaterial = (kind: MaterialKind) => materials.some((m) => m.kind === kind)
  const welcome = lessons.find((l) => l.kind === 'WELCOME')
  const wantsQuizzes = includes.success ? includes.data.includes.quizzes : true
  const wantsProject = includes.success ? includes.data.includes.projects : false

  const outcomes = learningOutcomeSchema.array().safeParse(course?.outcomes)
  const outcomeIds = outcomes.success ? outcomes.data.map((o) => o.id) : []
  const wantsPractice = includes.success ? includes.data.includes.exercises || includes.data.includes.quizzes : true

  const scripted = lessons.filter((l) => l.currentVersionId && (durations.get(l.currentVersionId)?.scenes ?? 0) > 0)
  const withVideo = lessons.filter((l) => l.currentVersion?.videoAssetId)
  const withPractice = lessons.filter((l) => l._count.exercises + l._count.assessmentItems > 0)
  const flagged = lessons.filter((l) => l.status === LessonStatus.QA_FLAGGED)
  const taught = new Set(lessons.flatMap((l) => l.objectiveRefs))
  const untaught = outcomeIds.filter((id) => !taught.has(id))
  const unassessed = outcomeIds.filter((id) => !assessedRefs.includes(id))
  const sceneTotals = scripted.reduce(
    (acc, l) => {
      const d = durations.get(l.currentVersionId ?? '')
      return {
        scenes: acc.scenes + (d?.scenes ?? 0),
        stills: acc.stills + (d?.stills ?? 0),
        narrated: acc.narrated + (d?.narrated ?? 0),
      }
    },
    { scenes: 0, stills: 0, narrated: 0 }
  )
  /* Fully narrated → measured audio lengths; otherwise script estimates. */
  const measured = sceneTotals.scenes > 0 && sceneTotals.narrated === sceneTotals.scenes
  const totalMs = scripted.reduce((sum, l) => {
    const d = durations.get(l.currentVersionId ?? '')
    return sum + (measured ? (d?.measuredMs ?? 0) : (d?.estimatedMs ?? 0))
  }, 0)
  const minutes = Math.round((totalMs / 60_000) * 10) / 10

  const checks: QualityCheck[] = [
    {
      id: 'lectures',
      label: `At least ${COURSE_QUALITY_MINIMUMS.lectures} lectures`,
      passed: lessons.length >= COURSE_QUALITY_MINIMUMS.lectures,
      detail: `${lessons.length} lectures`,
    },
    {
      id: 'video_length',
      label: `At least ${COURSE_QUALITY_MINIMUMS.videoMinutes} minutes of video`,
      passed: minutes >= COURSE_QUALITY_MINIMUMS.videoMinutes,
      detail: measured ? `${minutes} min of narrated video` : `≈${minutes} min estimated from scripts`,
    },
    {
      id: 'scripts',
      label: 'Every lecture has a video script',
      passed: scripted.length === lessons.length,
      detail: `${scripted.length} of ${lessons.length} scripted`,
    },
    {
      id: 'visuals',
      label: 'Every scene has its visual rendered',
      passed: sceneTotals.scenes > 0 && sceneTotals.stills === sceneTotals.scenes,
      detail: `${sceneTotals.stills} of ${sceneTotals.scenes} scenes rendered`,
    },
    {
      id: 'narration',
      label: 'Every scene is narrated',
      passed: measured,
      detail: `${sceneTotals.narrated} of ${sceneTotals.scenes} scenes narrated`,
    },
    {
      id: 'videos',
      label: 'Every lecture has a video',
      passed: lessons.length > 0 && withVideo.length === lessons.length,
      detail: `${withVideo.length} of ${lessons.length} lecture videos rendered`,
    },
    {
      id: 'welcome',
      label: 'The course opens with a welcome video',
      passed: Boolean(welcome?.currentVersion?.videoAssetId),
      detail: welcome ? (welcome.currentVersion?.videoAssetId ? 'Welcome video rendered' : 'Welcome lecture not rendered yet') : 'No welcome lecture yet',
    },
    {
      id: 'final_assessment',
      label: 'There is a final assessment',
      passed: !wantsQuizzes || finalItems.length > 0,
      detail: wantsQuizzes ? `${finalItems.length} questions` : 'Not requested in the brief',
    },
    {
      id: 'project',
      label: 'There is a final project',
      passed: !wantsProject || course?.finalProject != null,
      detail: wantsProject ? (course?.finalProject != null ? 'Project brief written' : 'No project yet') : 'Not requested in the brief',
    },
    {
      id: 'practice',
      label: 'Every lecture has practice (exercise or quiz)',
      passed: !wantsPractice || withPractice.length === lessons.length,
      detail: wantsPractice ? `${withPractice.length} of ${lessons.length} have practice` : 'Not requested in the brief',
    },
    {
      id: 'downloads',
      label: 'There are downloadable resources (workbook and cheat sheet)',
      passed: hasMaterial('WORKBOOK') && hasMaterial('CHEAT_SHEET'),
      detail: materials.length > 0 ? `${materials.length} downloads built` : 'No downloads built yet',
    },
    {
      id: 'outcomes_taught',
      label: 'Every learning outcome is taught',
      passed: untaught.length === 0,
      detail: untaught.length === 0 ? `${outcomeIds.length} outcomes covered` : `Not taught: ${untaught.join(', ')}`,
    },
    {
      id: 'outcomes_assessed',
      label: 'Every learning outcome is assessed',
      passed: !(includes.success && includes.data.includes.quizzes) || unassessed.length === 0,
      detail: unassessed.length === 0 ? 'All outcomes have questions' : `No questions for: ${unassessed.join(', ')}`,
    },
    {
      id: 'qa',
      label: 'No lessons flagged by QA',
      passed: flagged.length === 0,
      detail: flagged.length === 0 ? 'All lessons passed review' : `Flagged: ${flagged.map((l) => l.title).join('; ')}`,
    },
  ]

  return { computedAt: new Date().toISOString(), lectures: lessons.length, estimatedVideoMinutes: minutes, checks }
}
