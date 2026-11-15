/**
 * SOURCE OF TRUTH KEYWORDS: COURSE_MATERIALS, CourseMaterialDefinition,
 *   MATERIAL_BUILD_ORDER, MATERIAL_DISPLAY_ORDER, CODE_FILE_EXTENSIONS,
 *   codeFileExtension, download catalog, MaterialKind, COURSE_PACKAGE
 *
 * WHAT:  The catalog of downloadable course materials: title, audience,
 *        file name and MIME type for every MaterialKind, plus the language →
 *        file extension map used when code is written to files.
 * WHY:   One table drives the builder, storage keys, the course Materials tab
 *        and the learner Resources tab. Adding a material is one entry here
 *        and one renderer; changing who may download a file is one field.
 * WHERE: materialsBuilder agent, materialAssetKey, courses.materials,
 *        src/lib/render/source-archive.ts.
 */

import { MaterialAudience, MaterialKind, type JobKind } from '@/generated/prisma'
import type { CourseMaterialDefinition, DownloadMaterialKind, PackageMaterialKind } from '@/lib/types'

export const COURSE_MATERIALS: Record<MaterialKind, CourseMaterialDefinition> = {
  WORKBOOK: {
    title: 'Course workbook',
    description: 'Lecture notes, exercises and review questions to print or annotate',
    audience: MaterialAudience.LEARNER,
    fileName: 'workbook.pdf',
    mimeType: 'application/pdf',
  },
  CHEAT_SHEET: {
    title: 'Cheat sheet',
    description: 'The whole course on one or two pages',
    audience: MaterialAudience.LEARNER,
    fileName: 'cheat-sheet.pdf',
    mimeType: 'application/pdf',
  },
  GLOSSARY: {
    title: 'Glossary',
    description: 'Every key term with a plain definition',
    audience: MaterialAudience.LEARNER,
    fileName: 'glossary.pdf',
    mimeType: 'application/pdf',
  },
  SOURCE_CODE: {
    title: 'Source code',
    description: 'Code demos, exercise files and the project starter',
    audience: MaterialAudience.LEARNER,
    fileName: 'source-code.zip',
    mimeType: 'application/zip',
  },
  ANSWER_KEY: {
    title: 'Answer key',
    description: 'Exercise solutions, quiz answers, project rubric and reference solution',
    audience: MaterialAudience.INSTRUCTOR,
    fileName: 'answer-key.pdf',
    mimeType: 'application/pdf',
  },
  COURSE_PACKAGE: {
    title: 'Course package',
    description: 'Videos, captions, downloads and outline in one ZIP for Udemy, Teachable or Thinkific',
    audience: MaterialAudience.INSTRUCTOR,
    fileName: 'course-package.zip',
    mimeType: 'application/zip',
  },
  SCORM_PACKAGE: {
    title: 'SCORM package',
    description: 'SCORM 1.2 ZIP for Moodle, TalentLMS, Docebo or any LMS, with completion and score tracking',
    audience: MaterialAudience.INSTRUCTOR,
    fileName: 'scorm-package.zip',
    mimeType: 'application/zip',
  },
}

/** What the materials builder produces, in build order. */
export const MATERIAL_BUILD_ORDER: readonly DownloadMaterialKind[] = [
  MaterialKind.WORKBOOK,
  MaterialKind.CHEAT_SHEET,
  MaterialKind.GLOSSARY,
  MaterialKind.SOURCE_CODE,
  MaterialKind.ANSWER_KEY,
]

/** Display order of materials in every list (the export package last). */
export const MATERIAL_DISPLAY_ORDER: readonly MaterialKind[] = [
  ...MATERIAL_BUILD_ORDER,
  MaterialKind.COURSE_PACKAGE,
  MaterialKind.SCORM_PACKAGE,
]

/**
 * SOURCE OF TRUTH KEYWORDS: EXPORT_JOB_PACKAGES, export job → package
 *
 * WHAT:  Which package each export job produces, so the course page can open
 *        and download the right file when the job finishes.
 */
export const EXPORT_JOB_PACKAGES: Readonly<Partial<Record<JobKind, PackageMaterialKind>>> = {
  EXPORT_COURSE: MaterialKind.COURSE_PACKAGE,
  EXPORT_SCORM: MaterialKind.SCORM_PACKAGE,
}

export const CODE_FILE_EXTENSIONS: Readonly<Record<string, string>> = {
  javascript: 'js',
  js: 'js',
  jsx: 'jsx',
  typescript: 'ts',
  ts: 'ts',
  tsx: 'tsx',
  python: 'py',
  py: 'py',
  java: 'java',
  kotlin: 'kt',
  swift: 'swift',
  go: 'go',
  rust: 'rs',
  ruby: 'rb',
  php: 'php',
  csharp: 'cs',
  'c#': 'cs',
  cpp: 'cpp',
  'c++': 'cpp',
  c: 'c',
  html: 'html',
  css: 'css',
  scss: 'scss',
  sql: 'sql',
  bash: 'sh',
  shell: 'sh',
  sh: 'sh',
  json: 'json',
  yaml: 'yml',
  yml: 'yml',
  markdown: 'md',
  md: 'md',
  dart: 'dart',
  r: 'r',
}

export function codeFileExtension(language: string | null): string {
  return (language && CODE_FILE_EXTENSIONS[language.trim().toLowerCase()]) || 'txt'
}
