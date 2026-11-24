import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: loadLessonFigures, lesson figures, figures for
 *   notes, resize illustration, NOTES_FIGURE_WIDTH, diagram data URL
 *
 * WHAT:  Every lesson's rendered diagrams and illustrations (current
 *        version, video order) as LessonFigure data URLs, keyed by lesson id.
 * WHY:   The written notes (workbook PDF, SCORM notes) should show the same
 *        visuals the video teaches with. Diagrams are small SVGs and are
 *        embedded as is; illustrations are downscaled to a JPEG suited to a
 *        page, because the originals (about 2.7K wide, several MB) would make
 *        documents heavy. Missing files are skipped, never fatal.
 * WHERE: loadMaterialSource (src/lib/courses/material-source.ts), which also
 *        feeds loadCoursePackageInput.
 */

import { z } from 'zod'

import type { DbClient } from '@/lib/config'
import type { LessonFigure } from '@/lib/types'
import { getStorage } from '@/lib/storage'
import * as materialService from '@/services/material.service'

/* Wide enough for a full page width in print, small enough to keep files light. */
const NOTES_FIGURE_WIDTH = 1280
const NOTES_JPEG_QUALITY = 80

/* The only fields read from a scene's on-screen spec. */
const figureTextSchema = z.object({ heading: z.string(), caption: z.string().nullable().optional() })

async function illustrationDataUrl(bytes: Uint8Array): Promise<string> {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas')
  const image = await loadImage(Buffer.from(bytes))
  const scale = Math.min(1, NOTES_FIGURE_WIDTH / image.width)
  const width = Math.round(image.width * scale)
  const height = Math.round(image.height * scale)
  const canvas = createCanvas(width, height)
  canvas.getContext('2d').drawImage(image, 0, 0, width, height)
  const jpeg = await canvas.encode('jpeg', NOTES_JPEG_QUALITY)
  return `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`
}

export async function loadLessonFigures(db: DbClient, courseId: string): Promise<Map<string, LessonFigure[]>> {
  const storage = getStorage()
  const rows = await materialService.listLessonFigureScenes(db, courseId)
  const figures = new Map<string, LessonFigure[]>()

  for (const row of rows) {
    const list: LessonFigure[] = []
    for (const scene of row.currentVersion?.scenes ?? []) {
      const text = figureTextSchema.safeParse(scene.onScreen)
      const caption = text.success ? (text.data.caption ?? text.data.heading) : ''
      try {
        if (scene.type === 'ILLUSTRATION' && scene.imageAsset) {
          const object = await storage.get(scene.imageAsset.storageKey)
          if (object) list.push({ kind: 'illustration', src: await illustrationDataUrl(object.body), caption })
        } else if ((scene.type === 'DIAGRAM' || scene.type === 'GRAPH') && scene.diagramAsset) {
          const object = await storage.get(scene.diagramAsset.storageKey)
          if (object) list.push({ kind: 'diagram', src: `data:image/svg+xml;base64,${Buffer.from(object.body).toString('base64')}`, caption })
        }
      } catch (error) {
        console.warn(`[figures] skipped a ${scene.type.toLowerCase()} for lesson ${row.id}:`, error instanceof Error ? error.message : error)
      }
    }
    if (list.length > 0) figures.set(row.id, list)
  }
  return figures
}
