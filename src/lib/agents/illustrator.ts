import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: illustrateScene, Illustrator, illustration style,
 *   lecture illustration, generated picture, MAX_ILLUSTRATIONS_PER_LESSON,
 *   ILLUSTRATION_RULES, illustration style per learner level
 *
 * WHAT:  Produces the picture for one ILLUSTRATION scene: reuses the stored
 *        image when the scene already has one, otherwise asks the model
 *        routed to IMAGE_GENERATION for a widescreen picture in the style of
 *        the course's learner level and stores it.
 * WHY:   Pictures cost money and should not change between renders, so an
 *        image is generated once per scene and reused when the slide is
 *        re-rendered (new narration, theme change). The Video Director writes
 *        WHAT the picture shows; the level's style keeps a course visually
 *        consistent and right for its learners, and the rules keep it free
 *        of text (image models misspell words,
 *        and on-screen words belong to the slide, not the picture).
 * WHERE: Visual Renderer (src/lib/agents/visual-renderer.ts), per scene.
 */

import type { DbClient } from '@/lib/config'
import type { AiCallContext } from '@/lib/types'
import { generateImage } from '@/lib/ai'
import { getStorage, sceneAssetKey } from '@/lib/storage'
import * as assetService from '@/services/asset.service'

/* A lecture keeps its slides as the main teaching surface; a few pictures
 * add life without turning the course into an image budget. */
export const MAX_ILLUSTRATIONS_PER_LESSON = 4

/* Rules every picture follows; the look itself comes from the learner level
 * (LearnerLevelGuide.illustrationStyle), so toddlers get picture book art
 * and PhD researchers journal style figures. */
const ILLUSTRATION_RULES =
  'Wide 16:9 composition with the subject centred and clear, uncluttered background. ' +
  'Do not include any text, letters, numbers, labels, logos or watermarks.'

const NEGATIVE_PROMPT = 'text, letters, words, numbers, captions, watermark, logo, signature, blurry, distorted faces, extra fingers, cluttered'

export interface IllustrationImage {
  bytes: Uint8Array
  mimeType: string
  /** Set when the image was generated now and must be saved as an asset. */
  fresh: { storageKey: string } | null
  /** Set when an existing asset was reused. */
  assetId: string | null
}

export async function illustrateScene(
  db: DbClient,
  params: {
    context: AiCallContext
    prompt: string
    /** The learner level's illustration style. */
    style: string
    existingAssetId: string | null
    keyBase: { organizationId: string; courseId: string; lessonId: string; sceneId: string }
  }
): Promise<IllustrationImage> {
  const storage = getStorage()
  if (params.existingAssetId) {
    const asset = await assetService.findAssetById(db, params.existingAssetId)
    const object = asset ? await storage.get(asset.storageKey) : null
    if (asset && object) return { bytes: object.body, mimeType: asset.mimeType, fresh: null, assetId: asset.id }
  }

  const result = await generateImage({
    context: params.context,
    prompt: `${params.prompt.trim()}\n\nStyle: ${params.style} ${ILLUSTRATION_RULES}`,
    negativePrompt: NEGATIVE_PROMPT,
  })
  const storageKey = sceneAssetKey({ ...params.keyBase, variant: 'image', extension: result.extension })
  await storage.put({ key: storageKey, body: result.image, contentType: result.mimeType })
  return { bytes: result.image, mimeType: result.mimeType, fresh: { storageKey }, assetId: null }
}
