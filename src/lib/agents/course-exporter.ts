import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: courseExporterAgent, Course Exporter, course
 *   export package, COURSE_PACKAGE, EXPORT_COURSE, Udemy upload ZIP
 *
 * WHAT:  Exports the course as the Udemy / Teachable upload package
 *        (buildCoursePackage), stored as the instructor only COURSE_PACKAGE.
 * WHY:   A tool step: no model call. It packages what exists instead of
 *        refusing a partial course; the output and the package README say how
 *        many lectures still lack a video. Loading, storage and linking are
 *        shared by definePackageExporter.
 * WHERE: Registered as `courseExporter`; the only task of EXPORT_COURSE jobs.
 */

import { MaterialKind } from '@/generated/prisma'
import { buildCoursePackage } from '@/lib/render/course-package'
import { definePackageExporter } from './package-exporter'

export const courseExporterAgent = definePackageExporter({
  name: 'Course Exporter',
  description: 'Packs videos, captions, notes, quizzes and downloads into one ZIP',
  kind: MaterialKind.COURSE_PACKAGE,
  build: async (input, read) => {
    const { zip, manifest, missingVideos } = await buildCoursePackage(input, read)
    return {
      zip,
      summary: {
        sections: manifest.sections.length,
        lectures: manifest.sections.reduce((sum, s) => sum + s.lectures.length, 0),
        missingVideos,
        resources: manifest.resources.length,
      },
    }
  },
})
