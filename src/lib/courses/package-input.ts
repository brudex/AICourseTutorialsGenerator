import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: loadCoursePackageInput, CoursePackageInput,
 *   export input loader, course export, SCORM export
 *
 * WHAT:  Loads and validates everything an export package is built from:
 *        landing copy, sections, every lecture with its stored video and
 *        captions, the material source (quizzes, assessment, project) and
 *        the built downloads.
 * WHY:   Every export format (Udemy package, SCORM) packs the same course, so
 *        they share one loader and differ only in how they lay the files out.
 * WHERE: courseExporter and scormExporter agents.
 */

import { COURSE_MATERIALS, MATERIAL_BUILD_ORDER, type DbClient } from '@/lib/config'
import { courseBriefSchema, lessonContentSchema, type CoursePackageInput } from '@/lib/types'
import { loadMaterialSource } from '@/lib/courses/material-source'
import { AgentInputError } from '@/lib/generation/errors'
import * as courseService from '@/services/course.service'
import * as materialService from '@/services/material.service'

export async function loadCoursePackageInput(db: DbClient, organizationId: string, courseId: string): Promise<CoursePackageInput> {
  const course = await courseService.findCourseWithCurriculum(db, organizationId, courseId)
  if (!course) throw new AgentInputError('Course not found.')
  const brief = courseBriefSchema.safeParse(course.brief)
  if (!brief.success) throw new AgentInputError('The course brief is invalid. Edit it first.')
  const [source, lectureRows, materialRows] = await Promise.all([
    loadMaterialSource(db, organizationId, courseId),
    materialService.listExportLectures(db, courseId),
    materialService.listMaterialFiles(db, courseId, MATERIAL_BUILD_ORDER),
  ])

  return {
    course: {
      title: course.title,
      subtitle: course.subtitle,
      description: course.description,
      goal: course.goal,
      whatYouWillLearn: course.whatYouWillLearn,
      requirements: course.requirements,
      targetAudience: course.targetAudience,
      language: brief.data.language,
      difficulty: brief.data.difficulty,
    },
    modules: course.modules.map((m) => ({ id: m.id, title: m.title })),
    lectures: lectureRows.map((l) => {
      const content = lessonContentSchema.safeParse(l.currentVersion?.content)
      return {
        lessonId: l.id,
        moduleId: l.moduleId,
        title: l.title,
        kind: l.kind,
        estimatedMinutes: l.estimatedMinutes,
        content: content.success ? content.data : null,
        video: l.currentVersion?.videoAsset ?? null,
        captionsKey: l.currentVersion?.captionsAsset?.storageKey ?? null,
        figures: source.lessons.find((lesson) => lesson.lessonId === l.id)?.figures ?? [],
      }
    }),
    source,
    materials: MATERIAL_BUILD_ORDER.flatMap((kind) => {
      const row = materialRows.find((m) => m.kind === kind)
      return row
        ? [{ title: row.title, audience: row.audience, fileName: COURSE_MATERIALS[kind].fileName, storageKey: row.asset.storageKey }]
        : []
    }),
  }
}
