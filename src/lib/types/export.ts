/**
 * SOURCE OF TRUTH KEYWORDS: CoursePackageManifest, CoursePackageSection,
 *   CoursePackageLecture, course.json, course export package, COURSE_PACKAGE_FORMAT
 *
 * WHAT:  The `course.json` manifest at the root of an exported course
 *        package: landing copy, sections and lectures with the relative path
 *        of every file, resources, assessments and project.
 * WHY:   A stable, versioned description of the package so other tools (an
 *        importer, a SCORM wrapper, an LMS) can read an
 *        export without parsing folder names. Bump `version` on breaking
 *        changes. Built from existing content types, so the copy fields stay
 *        in step with the course landing schema.
 *        CoursePackageInput is everything the package builder needs, already
 *        loaded and validated, so the builder never touches the database.
 * WHERE: src/lib/render/course-package.ts (writes it), courseExporter agent.
 */

import type { LessonKind, MaterialAudience } from '@/generated/prisma'
import type { AssessmentItemContent, CourseBrief, CourseLanding, LessonContent } from './course-content'
import type { LessonFigure, MaterialSource } from './materials'

export const COURSE_PACKAGE_FORMAT = { name: 'ai-course-package', version: 1 } as const

export interface CoursePackageLecture {
  title: string
  kind: LessonKind
  estimatedMinutes: number
  videoDurationSeconds: number | null
  /* Paths relative to the package root; null when the file does not exist yet. */
  video: string | null
  captions: string | null
  notes: string | null
  quiz: string | null
}

export interface CoursePackageSection {
  title: string
  lectures: CoursePackageLecture[]
  quiz: string | null
}

export interface CoursePackageManifest {
  format: typeof COURSE_PACKAGE_FORMAT.name
  version: typeof COURSE_PACKAGE_FORMAT.version
  exportedAt: string
  /* Landing copy may not be written yet, so the free-text fields are nullable. */
  course: Omit<CourseLanding, 'subtitle' | 'description'> & {
    subtitle: string | null
    description: string | null
    goal: string | null
  } & Pick<CourseBrief, 'language' | 'difficulty'>
  sections: CoursePackageSection[]
  resources: Array<{ title: string; file: string; audience: MaterialAudience }>
  finalAssessment: string | null
  project: string | null
}

export interface CoursePackageLectureInput {
  lessonId: string
  moduleId: string
  title: string
  kind: LessonKind
  estimatedMinutes: number
  content: LessonContent | null
  video: { storageKey: string; durationMs: number | null } | null
  captionsKey: string | null
  /** Diagrams and illustrations for the lecture notes. */
  figures: LessonFigure[]
}

export interface CoursePackageInput {
  course: CoursePackageManifest['course']
  modules: ReadonlyArray<{ id: string; title: string }>
  lectures: readonly CoursePackageLectureInput[]
  source: MaterialSource
  materials: ReadonlyArray<{ title: string; audience: MaterialAudience; fileName: string; storageKey: string }>
}

/**
 * SOURCE OF TRUTH KEYWORDS: ScormCourseData, ScormLecture, ScormSection,
 *   SCORM_MASTERY_SCORE, SCORM 1.2 player data
 *
 * WHAT:  The data the SCORM player (index.html) reads from course-data.js:
 *        sections and lectures with media paths and pre-rendered notes HTML,
 *        quizzes, the final assessment, the project brief and learner
 *        resources. Never contains instructor files.
 * WHY:   The player is static HTML running inside a learning system, so all
 *        content ships as one data object; questions are passed as their
 *        validated content type so the player grades exactly what the studio
 *        shows.
 * WHERE: src/lib/render/scorm-package.ts (writes it), scorm-player.ts (reads it).
 */
export const SCORM_MASTERY_SCORE = 80

export interface ScormLecture {
  title: string
  minutes: number
  video: string | null
  captions: string | null
  notesHtml: string
  quiz: AssessmentItemContent[]
}

export interface ScormSection {
  title: string
  lectures: ScormLecture[]
  quiz: AssessmentItemContent[]
}

export interface ScormCourseData {
  title: string
  subtitle: string | null
  language: string
  masteryScore: number
  sections: ScormSection[]
  finalAssessment: AssessmentItemContent[]
  projectHtml: string | null
  resources: Array<{ title: string; file: string }>
}
