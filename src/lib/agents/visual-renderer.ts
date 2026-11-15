import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: visualRendererAgent, Visual Renderer, render
 *   visuals, scene stills, Mermaid repair, mermaidRepairSchema
 *
 * WHAT:  For every scene of a lesson's current version: renders DIAGRAM
 *        Mermaid to SVG, draws ILLUSTRATION pictures (illustrateScene, reused
 *        once made), renders the full scene to a 1920×1080 PNG still,
 *        stores both via the StorageAdapter, records Asset rows, and links
 *        them on the scene. Mermaid is cleaned by normalizeMermaid before
 *        parsing (one-line sources, style lines, unquoted labels).
 * WHY:   A tool step, not a writing agent (blueprint §6: tools stay tools) —
 *        it only calls a model when a diagram fails to parse: the parser's
 *        error goes back to the model (up to MAX_DIAGRAM_REPAIRS times) and a
 *        repaired diagram replaces the stored source so script, still, and
 *        video agree. A diagram that still fails does NOT fail the lesson: the
 *        scene keeps a "diagram unavailable" still and `visualError`, which
 *        the course readiness report surfaces. Files are written before the
 *        DB transaction; if the job was cancelled meanwhile, nothing is linked
 *        (orphaned files are overwritten by the next render of the version).
 * WHERE: Registered as `visualRenderer`; after videoDirector in BUILD_COURSE,
 *        and alone per lesson in RENDER_VISUALS jobs.
 */

import { z } from 'zod'

import { AiCapability, AssetKind, SceneType } from '@/generated/prisma'
import { prisma } from '@/lib/config'
import { SLIDE_SIZE } from '@/lib/config/slide-theme'
import { courseBriefSchema, sceneSchema, type AgentDefinition, type Scene } from '@/lib/types'
import { DEFAULT_LEARNER_LEVEL, learnerLevelGuide } from '@/lib/config/learner-levels'
import { generateStructured, hasRouteFor } from '@/lib/ai'
import { normalizeMermaid, renderMermaidSvg, renderSceneStill } from '@/lib/render'
import { getStorage, sceneAssetKey } from '@/lib/storage'
import { AgentInputError } from '@/lib/generation/errors'
import * as assetService from '@/services/asset.service'
import * as courseService from '@/services/course.service'
import * as lessonService from '@/services/lesson.service'
import { assertJobLive } from './define-agent'
import { lessonAgentInputSchema, loadCurrentLessonContent } from './course-context'
import { illustrateScene, MAX_ILLUSTRATIONS_PER_LESSON } from './illustrator'

const MAX_DIAGRAM_REPAIRS = 2
const mermaidRepairSchema = z.object({ mermaid: z.string().min(1).max(4_000) })

type DiagramScene = Extract<Scene, { type: 'DIAGRAM' }>

export const visualRendererAgent: AgentDefinition = {
  name: 'Visual Renderer',
  description: 'Renders diagrams and every scene’s slide as image files',
  capability: AiCapability.FAST_TEXT,

  async execute(execution) {
    const parsed = lessonAgentInputSchema.safeParse(execution.task.input)
    if (!parsed.success) throw new AgentInputError('Task input for Visual Renderer is invalid.')
    const { lessonId } = parsed.data
    const { db, job, task } = execution

    const [written, lesson, course] = await Promise.all([
      loadCurrentLessonContent(db, lessonId),
      lessonService.findLessonForAgent(db, job.courseId, lessonId),
      courseService.findCourse(db, job.organizationId, job.courseId),
    ])
    if (!lesson || !course) throw new AgentInputError('The lesson no longer exists.')
    /* Pictures are drawn in the learner level's style. */
    const level = courseBriefSchema.safeParse(course.brief).data?.audienceProfile.level ?? DEFAULT_LEARNER_LEVEL
    const illustrationStyle = learnerLevelGuide(level).illustrationStyle

    const rows = await lessonService.listVersionScenes(db, written.versionId)
    if (rows.length === 0) throw new AgentInputError('The lesson has no video script to render.')

    const storage = getStorage()
    let diagrams = 0
    let repaired = 0
    let failedDiagrams = 0
    let illustrations = 0
    let failedIllustrations = 0
    /* No image model routed: illustration scenes become captioned slides. */
    const canIllustrate = await hasRouteFor(db, job.organizationId, AiCapability.IMAGE_GENERATION)
    const aiContext = { organizationId: job.organizationId, agentId: 'visualRenderer', courseId: job.courseId, lessonId, jobId: job.id, taskId: task.id }

    /* Repair loop for one diagram: parser error → model fix → re-render. */
    async function renderDiagram(scene: DiagramScene): Promise<{ svg: string | null; source: string; error: string | null }> {
      /* Deterministic clean-up first; the model repair loop handles the rest. */
      let source = normalizeMermaid(scene.onScreen.mermaid)
      let result = await renderMermaidSvg(source)
      for (let attempt = 0; !result.ok && attempt < MAX_DIAGRAM_REPAIRS; attempt++) {
        const fix = await generateStructured({
          context: {
            organizationId: job.organizationId,
            agentId: 'visualRenderer',
            courseId: job.courseId,
            lessonId,
            jobId: job.id,
            taskId: task.id,
          },
          capability: AiCapability.FAST_TEXT,
          schema: mermaidRepairSchema,
          schemaName: 'mermaid_fix',
          temperature: 0,
          messages: [
            {
              role: 'system',
              content:
                'You fix Mermaid diagram syntax. Keep the same meaning, nodes, and labels; change only what is needed for it to parse. Put every statement on its own line (real line breaks). Wrap any label containing ( ) [ ] { } < > : ; # & or quotes in double quotes, e.g. A["Profit (loss)"]. Every subgraph needs a name. Do not use style, classDef, class, click or linkStyle lines. Keep labels short.',
            },
            {
              role: 'user',
              content: `Diagram: ${scene.onScreen.heading}\n\nMermaid source:\n${source}\n\nParser error:\n${result.error}`,
            },
          ],
        })
        source = normalizeMermaid(fix.data.mermaid)
        result = await renderMermaidSvg(source)
        if (result.ok) repaired++
      }
      return result.ok ? { svg: result.svg, source, error: null } : { svg: null, source, error: result.error.slice(0, 500) }
    }

    for (const row of rows) {
      const parsedScene = sceneSchema.safeParse({
        type: row.type,
        narration: row.narration,
        emphasis: row.emphasis,
        pauseAfterMs: row.pauseAfterMs,
        onScreen: row.onScreen,
      })
      if (!parsedScene.success) continue
      let scene = parsedScene.data

      let diagramSvg: string | null = null
      let visualError: string | null = null
      if (scene.type === SceneType.DIAGRAM) {
        diagrams++
        const diagram = await renderDiagram(scene)
        diagramSvg = diagram.svg
        visualError = diagram.error ? `Diagram could not be rendered: ${diagram.error}` : null
        if (diagram.error) failedDiagrams++
        if (diagram.source !== scene.onScreen.mermaid) scene = { ...scene, onScreen: { ...scene.onScreen, mermaid: diagram.source } }
      }

      const keyBase = { organizationId: job.organizationId, courseId: job.courseId, lessonId, sceneId: row.id }

      /* ILLUSTRATION: a generated picture (reused if the scene has one). */
      let imageDataUrl: string | null = null
      let freshImage: { storageKey: string; mimeType: string; bytes: number } | null = null
      let imageAssetId: string | null = row.imageAssetId
      if (scene.type === SceneType.ILLUSTRATION) {
        const reusable = row.imageAssetId !== null
        if (!canIllustrate && !reusable) {
          visualError = 'No illustration model is set up (AI Providers → Illustrations), so this scene shows its caption.'
        } else if (!reusable && illustrations >= MAX_ILLUSTRATIONS_PER_LESSON) {
          visualError = `Only ${MAX_ILLUSTRATIONS_PER_LESSON} pictures are drawn per lecture; this scene shows its caption.`
        } else {
          try {
            const picture = await illustrateScene(db, { context: aiContext, prompt: scene.onScreen.prompt, style: illustrationStyle, existingAssetId: row.imageAssetId, keyBase })
            illustrations++
            imageDataUrl = `data:${picture.mimeType};base64,${Buffer.from(picture.bytes).toString('base64')}`
            if (picture.fresh) freshImage = { storageKey: picture.fresh.storageKey, mimeType: picture.mimeType, bytes: picture.bytes.byteLength }
            imageAssetId = picture.assetId
          } catch (error) {
            failedIllustrations++
            visualError = `Illustration could not be drawn: ${(error instanceof Error ? error.message : 'unknown error').slice(0, 300)}`
          }
        }
      }

      const png = await renderSceneStill({ scene, diagramSvg, imageDataUrl, lessonTitle: lesson.title, courseTitle: course.title })
      const stillKey = sceneAssetKey({ ...keyBase, variant: 'still', extension: 'png' })
      await storage.put({ key: stillKey, body: png, contentType: 'image/png' })

      let diagramKey: string | null = null
      let diagramBytes = 0
      if (diagramSvg) {
        const svgBytes = new TextEncoder().encode(diagramSvg)
        diagramKey = sceneAssetKey({ ...keyBase, variant: 'diagram', extension: 'svg' })
        diagramBytes = svgBytes.byteLength
        await storage.put({ key: diagramKey, body: svgBytes, contentType: 'image/svg+xml' })
      }

      await prisma.$transaction(async (tx) => {
        await assertJobLive(tx, job.id)
        const still = await assetService.upsertAsset(tx, {
          organizationId: job.organizationId,
          courseId: job.courseId,
          lessonId,
          kind: AssetKind.IMAGE,
          storageKey: stillKey,
          mimeType: 'image/png',
          bytes: png.byteLength,
          width: SLIDE_SIZE.width,
          height: SLIDE_SIZE.height,
          sourceTaskId: task.id,
        })
        const diagramAsset = diagramKey
          ? await assetService.upsertAsset(tx, {
              organizationId: job.organizationId,
              courseId: job.courseId,
              lessonId,
              kind: AssetKind.SVG,
              storageKey: diagramKey,
              mimeType: 'image/svg+xml',
              bytes: diagramBytes,
              sourceTaskId: task.id,
            })
          : null
        const imageAsset = freshImage
          ? await assetService.upsertAsset(tx, {
              organizationId: job.organizationId,
              courseId: job.courseId,
              lessonId,
              kind: AssetKind.IMAGE,
              storageKey: freshImage.storageKey,
              mimeType: freshImage.mimeType,
              bytes: freshImage.bytes,
              sourceTaskId: task.id,
            })
          : null
        await lessonService.updateSceneVisuals(tx, row.id, {
          stillAssetId: still.id,
          diagramAssetId: diagramAsset?.id ?? null,
          imageAssetId: imageAsset?.id ?? imageAssetId,
          visualError,
          ...(scene.type === SceneType.DIAGRAM ? { onScreen: scene.onScreen } : {}),
        })
      })
    }

    return { output: { scenes: rows.length, diagrams, repairedDiagrams: repaired, failedDiagrams, illustrations, failedIllustrations } }
  },
}
