import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: materialsBuilderAgent, Materials Builder,
 *   course downloads, CourseMaterial, workbook PDF, answer key PDF, cheat
 *   sheet PDF, glossary PDF, source code ZIP, BUILD_MATERIALS
 *
 * WHAT:  Renders every downloadable material the course has content for
 *        (COURSE_MATERIALS), uploads each file, and links it with an Asset +
 *        CourseMaterial row. Materials whose content is gone (for example no
 *        code any more) are removed.
 * WHY:   A tool step: no model call. Files are uploaded before the
 *        transaction (slow I/O must not hold it); the transaction re-checks
 *        the job is still live, then writes the rows. Storage keys are fixed
 *        per kind, so a rebuild overwrites the previous file in place.
 * WHERE: Registered as `materialsBuilder`; last step of BUILD_COURSE and of
 *        BUILD_MATERIALS jobs.
 */

import { AiCapability, AssetKind } from '@/generated/prisma'
import { COURSE_MATERIALS, MATERIAL_BUILD_ORDER, prisma } from '@/lib/config'
import type { AgentDefinition, DownloadMaterialKind, MaterialSource, RenderedMaterial } from '@/lib/types'
import { loadMaterialSource } from '@/lib/courses/material-source'
import { answerKeyHtml, cheatSheetHtml, glossaryHtml, renderPdf, workbookHtml } from '@/lib/render/documents'
import { buildSourceArchive } from '@/lib/render/source-archive'
import { getStorage, materialAssetKey } from '@/lib/storage'
import { AgentInputError } from '@/lib/generation/errors'
import * as assetService from '@/services/asset.service'
import * as materialService from '@/services/material.service'
import { assertJobLive } from './define-agent'
import { courseAgentInputSchema } from './course-context'

/* One renderer per material kind; null means "nothing to build for this course". */
const pdf = (kind: DownloadMaterialKind, build: (s: MaterialSource) => Promise<string | null> | string | null) =>
  async (source: MaterialSource): Promise<Uint8Array | null> => {
    const html = await build(source)
    return html ? renderPdf(html, `${source.course.title} · ${COURSE_MATERIALS[kind].title}`) : null
  }

const RENDERERS: Record<DownloadMaterialKind, (source: MaterialSource) => Promise<Uint8Array | null>> = {
  WORKBOOK: pdf('WORKBOOK', workbookHtml),
  CHEAT_SHEET: pdf('CHEAT_SHEET', cheatSheetHtml),
  GLOSSARY: pdf('GLOSSARY', glossaryHtml),
  SOURCE_CODE: buildSourceArchive,
  ANSWER_KEY: pdf('ANSWER_KEY', (s) =>
    s.lessons.some((l) => l.exercises.length + l.quiz.length > 0) || s.sectionQuizzes.length || s.finalAssessment.length || s.project
      ? answerKeyHtml(s)
      : null
  ),
}

export const materialsBuilderAgent: AgentDefinition = {
  name: 'Materials Builder',
  description: 'Builds the downloads: workbook, cheat sheet, glossary, source code and answer key',
  capability: AiCapability.FAST_TEXT,

  async execute(execution) {
    const parsed = courseAgentInputSchema.safeParse(execution.task.input)
    if (!parsed.success) throw new AgentInputError('Task input for Materials Builder is invalid.')
    const { db, job, task } = execution
    const source = await loadMaterialSource(db, job.organizationId, parsed.data.courseId)

    /* Sequential: every PDF shares one headless browser. */
    const rendered: RenderedMaterial[] = []
    for (const kind of MATERIAL_BUILD_ORDER) {
      const body = await RENDERERS[kind](source)
      if (body) rendered.push({ kind, body })
    }

    const storage = getStorage()
    const keyOf = (kind: DownloadMaterialKind) => materialAssetKey({ organizationId: job.organizationId, courseId: job.courseId, kind })
    for (const file of rendered) {
      await storage.put({ key: keyOf(file.kind), body: file.body, contentType: COURSE_MATERIALS[file.kind].mimeType })
    }

    const staleKeys = await prisma.$transaction(async (tx) => {
      await assertJobLive(tx, job.id)
      for (const file of rendered) {
        const definition = COURSE_MATERIALS[file.kind]
        const asset = await assetService.upsertAsset(tx, {
          organizationId: job.organizationId,
          courseId: job.courseId,
          kind: file.kind === 'SOURCE_CODE' ? AssetKind.ARCHIVE : AssetKind.DOCUMENT,
          storageKey: keyOf(file.kind),
          mimeType: definition.mimeType,
          bytes: file.body.byteLength,
          sourceTaskId: task.id,
        })
        await materialService.upsertMaterial(tx, {
          organizationId: job.organizationId,
          courseId: job.courseId,
          kind: file.kind,
          audience: definition.audience,
          title: definition.title,
          assetId: asset.id,
        })
      }
      return materialService.deleteMaterialsExcept(tx, job.courseId, MATERIAL_BUILD_ORDER, rendered.map((f) => f.kind))
    })
    /* Best effort: a leftover file is harmless once its rows are gone. */
    await Promise.all(staleKeys.map((key) => storage.deletePrefix(key).catch(() => undefined)))

    return {
      output: {
        built: rendered.map((f) => f.kind),
        skipped: MATERIAL_BUILD_ORDER.filter((k) => !rendered.some((f) => f.kind === k)),
        kilobytes: Math.round(rendered.reduce((sum, f) => sum + f.body.byteLength, 0) / 1024),
      },
    }
  },
}
