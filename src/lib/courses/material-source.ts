import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: loadMaterialSource, MaterialSource, course
 *   downloads source, validated course content
 *
 * WHAT:  Loads everything the downloadable materials are built from (written
 *        lessons with exercises and quizzes, section quizzes, final
 *        assessment, project, cheat sheet, glossary terms) and validates every
 *        Json column on the way in.
 * WHY:   Renderers stay pure functions of one validated object. Rows whose
 *        Json no longer matches its schema are skipped instead of breaking a
 *        whole PDF; the glossary comes from the research dossier, so it costs
 *        no model call.
 * WHERE: materialsBuilder agent (src/lib/agents/materials-builder.ts).
 */

import type { DbClient } from '@/lib/config'
import {
  assessmentItemContentSchema,
  cheatSheetSchema,
  exerciseContentSchema,
  lessonContentSchema,
  projectBriefSchema,
  type AssessmentItemContent,
  type MaterialSource,
} from '@/lib/types'
import { AgentInputError } from '@/lib/generation/errors'
import * as courseService from '@/services/course.service'
import * as lessonService from '@/services/lesson.service'
import * as materialService from '@/services/material.service'
import { loadLatestDossier } from '@/lib/agents/course-context'
import { loadLessonFigures } from './lesson-figures'

const parseItems = (rows: ReadonlyArray<{ content: unknown }>): AssessmentItemContent[] =>
  rows.flatMap((row) => {
    const parsed = assessmentItemContentSchema.safeParse(row.content)
    return parsed.success ? [parsed.data] : []
  })

export async function loadMaterialSource(db: DbClient, organizationId: string, courseId: string): Promise<MaterialSource> {
  const course = await courseService.findCourseWithCurriculum(db, organizationId, courseId)
  if (!course) throw new AgentInputError('Course not found.')
  const [lessonRows, sectionRows, finalRows, dossier, figures] = await Promise.all([
    materialService.listMaterialLessons(db, courseId),
    lessonService.listSectionAssessments(db, courseId),
    lessonService.listFinalAssessments(db, courseId),
    loadLatestDossier(db, courseId),
    loadLessonFigures(db, courseId),
  ])

  const lessons = lessonRows.flatMap((row) => {
    const content = lessonContentSchema.safeParse(row.currentVersion?.content)
    if (!content.success) return []
    return [
      {
        lessonId: row.id,
        moduleTitle: row.module.title,
        modulePosition: row.module.position,
        title: row.title,
        content: content.data,
        exercises: row.exercises.flatMap((e) => {
          const parsed = exerciseContentSchema.safeParse(e.content)
          return parsed.success ? [{ level: e.level, title: e.title, content: parsed.data }] : []
        }),
        quiz: parseItems(row.assessmentItems),
        figures: figures.get(row.id) ?? [],
      },
    ]
  })
  if (lessons.length === 0) throw new AgentInputError('No lessons have been written yet.')

  const project = projectBriefSchema.safeParse(course.finalProject)
  const cheatSheet = cheatSheetSchema.safeParse(course.cheatSheet)
  return {
    course: { title: course.title, subtitle: course.subtitle },
    lessons,
    sectionQuizzes: course.modules
      .map((m) => ({ moduleId: m.id, moduleTitle: m.title, items: parseItems(sectionRows.filter((r) => r.moduleId === m.id)) }))
      .filter((s) => s.items.length > 0),
    finalAssessment: parseItems(finalRows),
    project: project.success ? project.data : null,
    cheatSheet: cheatSheet.success ? cheatSheet.data : null,
    glossary: [...(dossier?.terminology ?? [])].sort((a, b) => a.term.localeCompare(b.term)),
  }
}
