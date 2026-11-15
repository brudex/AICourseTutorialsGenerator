import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: loadPracticeView, loadMaterialRows, practice
 *   read model, downloads read model, section quizzes, final assessment
 *
 * WHAT:  Course read models: course-level practice (section quizzes, final
 *        assessment, project) and the list of downloads with sizes, each
 *        validated on the way out.
 * WHY:   Kept out of the router so any surface that shows practice and
 *        resources reads the same model. Callers pick the download audience
 *        (LEARNER or INSTRUCTOR).
 * WHERE: courses.practice / courses.materials.
 */

import type { MaterialAudience } from '@/generated/prisma'
import { COURSE_MATERIALS, MATERIAL_DISPLAY_ORDER, type DbClient } from '@/lib/config'
import { assessmentItemContentSchema, projectBriefSchema } from '@/lib/types'
import * as lessonService from '@/services/lesson.service'
import * as materialService from '@/services/material.service'

export async function loadPracticeView(
  db: DbClient,
  course: { id: string; finalProject: unknown; modules: ReadonlyArray<{ id: string; title: string; position: number }> }
) {
  const [sectionRows, finalRows] = await Promise.all([
    lessonService.listSectionAssessments(db, course.id),
    lessonService.listFinalAssessments(db, course.id),
  ])
  const toItem = (row: { id: string; objectiveRef: string; difficulty: string; content: unknown }) => {
    const content = assessmentItemContentSchema.safeParse(row.content)
    return content.success ? [{ id: row.id, objectiveRef: row.objectiveRef, difficulty: row.difficulty, content: content.data }] : []
  }
  const project = projectBriefSchema.safeParse(course.finalProject)
  return {
    sections: course.modules
      .map((m) => ({
        moduleId: m.id,
        title: m.title,
        position: m.position,
        items: sectionRows.filter((r) => r.moduleId === m.id).flatMap(toItem),
      }))
      .filter((s) => s.items.length > 0),
    finalAssessment: finalRows.flatMap(toItem),
    project: project.success ? project.data : null,
  }
}

export async function loadMaterialRows(db: DbClient, courseId: string, audience: MaterialAudience | null) {
  const rows = await materialService.listMaterials(db, courseId, audience)
  return MATERIAL_DISPLAY_ORDER.flatMap((kind) => {
    const row = rows.find((r) => r.kind === kind)
    if (!row) return []
    return [
      {
        id: row.id,
        kind: row.kind,
        audience: row.audience,
        title: row.title,
        description: COURSE_MATERIALS[kind].description,
        fileName: COURSE_MATERIALS[kind].fileName,
        assetId: row.assetId,
        bytes: row.asset.bytes,
        updatedAt: row.updatedAt,
      },
    ]
  })
}
