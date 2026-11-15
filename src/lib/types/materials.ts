/**
 * SOURCE OF TRUTH KEYWORDS: MaterialSource, MaterialLesson, RenderedMaterial,
 *   courseMaterialsQuerySchema, course downloads, workbook, answer key,
 *   cheat sheet, glossary, source code ZIP
 *
 * WHAT:  The validated course content every downloadable material is built
 *        from, the rendered file handed to storage, and the input of the
 *        courses.materials query.
 * WHY:   Materials are generated from Course State (no model call apart from
 *        the cheat sheet). Loading and validating it once into this shape lets
 *        each renderer (PDF documents, source ZIP) stay a pure function of its
 *        input. Built from the existing content types, so a change to a lesson,
 *        exercise or question schema flows through automatically.
 * WHERE: src/lib/courses/material-source.ts (builds it), src/lib/render/
 *        documents.ts and source-archive.ts (read it), materialsBuilder agent.
 */

import { z } from 'zod'

import { MaterialAudience, type MaterialKind } from '@/generated/prisma'
import type {
  AssessmentItemContent,
  CheatSheet,
  ExerciseSet,
  LessonContent,
  ProjectBrief,
  ResearchDossierContent,
} from './course-content'

/**
 * SOURCE OF TRUTH KEYWORDS: LessonFigure, lecture figure, notes figure,
 *   diagram in notes, illustration in notes
 *
 * WHAT:  A lecture visual for the written notes: a rendered diagram (SVG) or
 *        a generated illustration (resized JPEG), as a self-contained data
 *        URL with its caption.
 * WHY:   Data URLs keep the workbook PDF and SCORM notes single-file; the
 *        illustration is downscaled for documents (the video keeps the
 *        full-size original).
 * WHERE: loadLessonFigures → MaterialLesson / CoursePackageLectureInput →
 *        lessonBodyHtml.
 */
export interface LessonFigure {
  kind: 'diagram' | 'illustration'
  src: string
  caption: string
}

export interface MaterialLesson {
  lessonId: string
  moduleTitle: string
  modulePosition: number
  title: string
  content: LessonContent
  exercises: ExerciseSet['exercises']
  quiz: AssessmentItemContent[]
  /** The lecture's diagrams and illustrations, in video order. */
  figures: LessonFigure[]
}

export interface MaterialSource {
  course: { title: string; subtitle: string | null }
  lessons: MaterialLesson[]
  sectionQuizzes: Array<{ moduleId: string; moduleTitle: string; items: AssessmentItemContent[] }>
  finalAssessment: AssessmentItemContent[]
  project: ProjectBrief | null
  cheatSheet: CheatSheet | null
  glossary: ResearchDossierContent['terminology']
}

/* Export packages are built by the exporters; every other kind by the materials builder. */
export type PackageMaterialKind = Extract<MaterialKind, 'COURSE_PACKAGE' | 'SCORM_PACKAGE'>
export type DownloadMaterialKind = Exclude<MaterialKind, PackageMaterialKind>

export interface CourseMaterialDefinition {
  title: string
  description: string
  audience: MaterialAudience
  fileName: string
  mimeType: string
}

export interface RenderedMaterial {
  kind: DownloadMaterialKind
  body: Uint8Array
}

export const courseMaterialsQuerySchema = z.object({
  organizationId: z.string().min(1),
  courseId: z.string().min(1),
  /* Learner surfaces pass LEARNER so instructor-only files never reach them. */
  audience: z.enum(MaterialAudience).nullable(),
})

export type CourseMaterialsQueryValues = z.infer<typeof courseMaterialsQuerySchema>
