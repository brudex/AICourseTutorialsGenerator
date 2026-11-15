import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: definePackageExporter, export agent factory,
 *   PackageMaterialKind, course export, SCORM export, storeCoursePackage
 *
 * WHAT:  Builds a tool agent that loads the course (loadCoursePackageInput),
 *        packs it with a format-specific builder, uploads the ZIP and links
 *        it as an instructor only package material.
 * WHY:   Every export format shares loading, storage, the job-live check
 *        and the CourseMaterial link; only the layout differs. A new format
 *        (for example SCORM 2004 or xAPI) is one builder plus one call here.
 *        Upload happens before the transaction, which re-checks the job is
 *        still live before linking.
 * WHERE: courseExporter (src/lib/agents/course-exporter.ts) and
 *        scormExporter (src/lib/agents/scorm-exporter.ts).
 */

import { AiCapability, AssetKind, type Prisma } from '@/generated/prisma'
import { COURSE_MATERIALS, prisma } from '@/lib/config'
import type { AgentDefinition, CoursePackageInput, PackageMaterialKind } from '@/lib/types'
import { loadCoursePackageInput } from '@/lib/courses/package-input'
import { getStorage, materialAssetKey } from '@/lib/storage'
import { AgentInputError } from '@/lib/generation/errors'
import * as assetService from '@/services/asset.service'
import * as materialService from '@/services/material.service'
import { assertJobLive } from './define-agent'
import { courseAgentInputSchema } from './course-context'

export function definePackageExporter(config: {
  name: string
  description: string
  kind: PackageMaterialKind
  build: (
    input: CoursePackageInput,
    read: (storageKey: string) => Promise<Uint8Array>
  ) => Promise<{ zip: Uint8Array; summary: Prisma.InputJsonObject }>
}): AgentDefinition {
  return {
    name: config.name,
    description: config.description,
    capability: AiCapability.FAST_TEXT,

    async execute(execution) {
      const parsed = courseAgentInputSchema.safeParse(execution.task.input)
      if (!parsed.success) throw new AgentInputError(`Task input for ${config.name} is invalid.`)
      const { db, job, task } = execution
      const courseId = parsed.data.courseId
      const input = await loadCoursePackageInput(db, job.organizationId, courseId)

      const storage = getStorage()
      const { zip, summary } = await config.build(input, async (key) => {
        const object = await storage.get(key)
        if (!object) throw new AgentInputError(`A stored file is missing (${key.split('/').pop()}). Re-render it and export again.`)
        return object.body
      })

      const definition = COURSE_MATERIALS[config.kind]
      const key = materialAssetKey({ organizationId: job.organizationId, courseId, kind: config.kind })
      await storage.put({ key, body: zip, contentType: definition.mimeType })

      await prisma.$transaction(async (tx) => {
        await assertJobLive(tx, job.id)
        const asset = await assetService.upsertAsset(tx, {
          organizationId: job.organizationId,
          courseId,
          kind: AssetKind.ARCHIVE,
          storageKey: key,
          mimeType: definition.mimeType,
          bytes: zip.byteLength,
          sourceTaskId: task.id,
        })
        await materialService.upsertMaterial(tx, {
          organizationId: job.organizationId,
          courseId,
          kind: config.kind,
          audience: definition.audience,
          title: definition.title,
          assetId: asset.id,
        })
      })

      return { output: { ...summary, megabytes: Math.round((zip.byteLength / 1_048_576) * 10) / 10 } }
    },
  }
}
