import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: videoRendererAgent, Video Renderer, lecture MP4,
 *   render video, RENDER_VIDEO
 *
 * WHAT:  Renders a lesson's current version into one MP4 (stills + narration
 *        + embedded captions) with FFmpeg, stores it, and links it on the
 *        version as its lecture video.
 * WHY:   The last production step of the lesson package (docs/11 §1: every
 *        lecture has a video). A tool step: no model call. It requires every
 *        scene to have its still (visuals step) — a lecture with missing
 *        pictures is refused with a clear reason instead of rendered with
 *        holes. Narration is optional (silent video at estimated timing).
 *        The upload happens before the transaction; the transaction re-checks
 *        the job is still live before linking.
 * WHERE: Registered as `videoRenderer`; after visuals (and narration) in
 *        BUILD_COURSE, and alone per lesson in RENDER_VIDEO jobs.
 */

import { AiCapability, AssetKind } from '@/generated/prisma'
import { captionLanguageCode, prisma } from '@/lib/config'
import { SLIDE_SIZE } from '@/lib/config/slide-theme'
import type { AgentDefinition } from '@/lib/types'
import { renderLectureVideo, type VideoSceneInput } from '@/lib/render/video'
import { getStorage, versionAssetKey } from '@/lib/storage'
import { AgentInputError } from '@/lib/generation/errors'
import * as assetService from '@/services/asset.service'
import * as lessonService from '@/services/lesson.service'
import { assertJobLive } from './define-agent'
import { lessonAgentInputSchema, loadCourseForAgent, loadCurrentLessonContent } from './course-context'

const AUDIO_EXTENSIONS: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
}

export const videoRendererAgent: AgentDefinition = {
  name: 'Video Renderer',
  description: 'Renders the lecture MP4 from slides, narration and captions',
  capability: AiCapability.FAST_TEXT,

  async execute(execution) {
    const parsed = lessonAgentInputSchema.safeParse(execution.task.input)
    if (!parsed.success) throw new AgentInputError('Task input for Video Renderer is invalid.')
    const { lessonId } = parsed.data
    const { db, job, task } = execution

    const written = await loadCurrentLessonContent(db, lessonId)
    const version = await lessonService.findVersionForVideo(db, written.versionId)
    if (!version || version.scenes.length === 0) throw new AgentInputError('The lesson has no video script to render.')
    if (version.scenes.some((s) => !s.stillAsset)) {
      throw new AgentInputError('Some scenes have no rendered visual yet. Render visuals first.')
    }

    const storage = getStorage()
    const read = async (key: string) => {
      const object = await storage.get(key)
      if (!object) throw new AgentInputError(`A stored file is missing (${key.split('/').pop()}). Re-render the lesson media.`)
      return object.body
    }

    const scenes: VideoSceneInput[] = []
    for (const scene of version.scenes) {
      if (!scene.stillAsset) continue
      scenes.push({
        still: await read(scene.stillAsset.storageKey),
        audio: scene.audioAsset
          ? { bytes: await read(scene.audioAsset.storageKey), extension: AUDIO_EXTENSIONS[scene.audioAsset.mimeType] ?? 'mp3' }
          : null,
        durationMs: scene.durationMs ?? scene.estimatedDurationMs,
      })
    }
    const captionsVtt = version.captionsAsset
      ? new TextDecoder().decode(await read(version.captionsAsset.storageKey))
      : null

    const { brief } = await loadCourseForAgent(db, job.organizationId, job.courseId)
    const { mp4, durationMs } = await renderLectureVideo({ scenes, captionsVtt, captionLanguage: captionLanguageCode(brief.language) })
    const key = versionAssetKey({
      organizationId: job.organizationId,
      courseId: job.courseId,
      lessonId,
      versionId: version.id,
      variant: 'video',
      extension: 'mp4',
    })
    await storage.put({ key, body: mp4, contentType: 'video/mp4' })

    await prisma.$transaction(async (tx) => {
      await assertJobLive(tx, job.id)
      const asset = await assetService.upsertAsset(tx, {
        organizationId: job.organizationId,
        courseId: job.courseId,
        lessonId,
        kind: AssetKind.VIDEO,
        storageKey: key,
        mimeType: 'video/mp4',
        bytes: mp4.byteLength,
        width: SLIDE_SIZE.width,
        height: SLIDE_SIZE.height,
        durationMs,
        sourceTaskId: task.id,
      })
      await lessonService.updateVersionVideo(tx, version.id, asset.id)
    })

    const narrated = version.scenes.filter((s) => s.audioAsset).length
    return {
      output: {
        durationMs,
        megabytes: Math.round((mp4.byteLength / 1_048_576) * 10) / 10,
        silent: narrated === 0,
        captions: captionsVtt !== null,
      },
    }
  },
}
