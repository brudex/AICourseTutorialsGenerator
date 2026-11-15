import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS:⁠​‌‌​​‌‌​​‌​‌‌‌​​‌‌​‌​​​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​‌‌‌‌​​​‌​​‌​‌​​​‌​​‌‌‌⁠ scormExporterAgent, SCORM Exporter, SCORM 1.2,
 *   SCORM_PACKAGE, EXPORT_SCORM, LMS export
 *
 * WHAT:  Exports the course as a SCORM 1.2 package (buildScormPackage),
 *        stored as the instructor only SCORM_PACKAGE material for the author
 *        to upload to their LMS.
 * WHY:   A tool step: no model call. Shares loading, storage and linking with
 *        the course exporter through definePackageExporter.
 * WHERE: Registered as `scormExporter`; the only task of EXPORT_SCORM jobs.
 */

import { MaterialKind } from '@/generated/prisma'
import { buildScormPackage } from '@/lib/render/scorm-package'
import { definePackageExporter } from './package-exporter'

export const scormExporterAgent = definePackageExporter({
  name: 'SCORM Exporter',
  description: 'Packs the course as a SCORM 1.2 ZIP with completion and score tracking',
  kind: MaterialKind.SCORM_PACKAGE,
  build: async (input, read) => {
    const { zip, lectures, missingVideos, resources } = await buildScormPackage(input, read)
    return { zip, summary: { lectures, missingVideos, resources } }
  },
})
