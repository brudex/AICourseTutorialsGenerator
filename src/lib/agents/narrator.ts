import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: narratorAgent, Narrator, narration audio, TTS,
 *   captions, measured scene duration, narration pace per learner level
 *
 * WHAT:  Voices every scene of a lesson's current version with the
 *        workspace's narration voice (paced and styled for the course's
 *        learner level: slower and playful for toddlers), stores each clip, sets each scene's
 *        MEASURED duration (audio + pause), and writes the lecture's WebVTT
 *        captions plus total narrated length on the version.
 * WHY:   A tool step (blueprint §14: speech is a provider capability, not an
 *        agent that writes). Measured durations replace word-count estimates
 *        everywhere — storyboard timecodes, the player, the readiness report,
 *        and the video renderer's timeline in step 8 — so picture and voice
 *        cannot drift. Scenes are voiced in order; each clip is uploaded
 *        before the final transaction, which re-checks the job is still live.
 * WHERE: Registered as `narrator`; after videoDirector in BUILD_COURSE (only
 *        when a TTS model is routed) and alone in RENDER_NARRATION jobs.
 */

import { AiCapability, AssetKind } from '@/generated/prisma'
import { prisma } from '@/lib/config'
import { courseBriefSchema, type AgentDefinition } from '@/lib/types'
import { DEFAULT_LEARNER_LEVEL, learnerLevelGuide } from '@/lib/config/learner-levels'
import { synthesizeSpeech } from '@/lib/ai'
import { buildWebVtt, type CaptionScene } from '@/lib/render/captions'
import { getStorage, sceneAssetKey, versionAssetKey } from '@/lib/storage'
import { AgentInputError } from '@/lib/generation/errors'
import * as assetService from '@/services/asset.service'
import * as courseService from '@/services/course.service'
import * as lessonService from '@/services/lesson.service'
import * as voiceService from '@/services/voice.service'
import { assertJobLive } from './define-agent'
import { lessonAgentInputSchema, loadCurrentLessonContent } from './course-context'

interface VoicedScene {
  sceneId: string
  storageKey: string
  mimeType: string
  bytes: number
  audioMs: number
  pauseAfterMs: number
}

export const narratorAgent: AgentDefinition = {
  name: 'Narrator',
  description: 'Voices every scene and writes timed captions',
  capability: AiCapability.TTS,

  async execute(execution) {
    const parsed = lessonAgentInputSchema.safeParse(execution.task.input)
    if (!parsed.success) throw new AgentInputError('Task input for Narrator is invalid.')
    const { lessonId } = parsed.data
    const { db, job, task } = execution

    const written = await loadCurrentLessonContent(db, lessonId)
    const rows = await lessonService.listVersionScenes(db, written.versionId)
    if (rows.length === 0) throw new AgentInputError('The lesson has no video script to narrate.')
    const [profiles, course] = await Promise.all([
      voiceService.listVoiceProfiles(db, job.organizationId),
      courseService.findCourse(db, job.organizationId, job.courseId),
    ])
    /* Each model's saved voice (picked by the gateway), paced and styled for the course's learner level. */
    const level = courseBriefSchema.safeParse(course?.brief).data?.audienceProfile.level ?? DEFAULT_LEARNER_LEVEL
    const { speedFactor, delivery: style } = learnerLevelGuide(level).narration

    const storage = getStorage()
    const keyBase = { organizationId: job.organizationId, courseId: job.courseId, lessonId }
    const voiced: VoicedScene[] = []
    /* The voice id that actually spoke (the fallback model has its own). */
    let spokenVoice = ''

    for (const row of rows) {
      const speech = await synthesizeSpeech({
        context: {
          organizationId: job.organizationId,
          agentId: 'narrator',
          courseId: job.courseId,
          lessonId,
          jobId: job.id,
          taskId: task.id,
        },
        text: row.narration,
        profiles,
        delivery: { speedFactor, style },
      })
      spokenVoice = speech.voice
      const storageKey = sceneAssetKey({ ...keyBase, sceneId: row.id, variant: 'narration', extension: speech.extension })
      await storage.put({ key: storageKey, body: speech.audio, contentType: speech.mimeType })
      voiced.push({
        sceneId: row.id,
        storageKey,
        mimeType: speech.mimeType,
        bytes: speech.audio.byteLength,
        audioMs: speech.durationMs,
        pauseAfterMs: row.pauseAfterMs,
      })
    }

    const captionScenes: CaptionScene[] = rows.map((row, i) => ({
      narration: row.narration,
      audioMs: voiced[i]?.audioMs ?? 0,
      pauseAfterMs: row.pauseAfterMs,
    }))
    const vtt = new TextEncoder().encode(buildWebVtt(captionScenes))
    const captionsKey = versionAssetKey({ ...keyBase, versionId: written.versionId, variant: 'captions', extension: 'vtt' })
    await storage.put({ key: captionsKey, body: vtt, contentType: 'text/vtt' })
    const totalMs = voiced.reduce((sum, v) => sum + v.audioMs + v.pauseAfterMs, 0)

    await prisma.$transaction(
      async (tx) => {
        await assertJobLive(tx, job.id)
        for (const clip of voiced) {
          const asset = await assetService.upsertAsset(tx, {
            organizationId: job.organizationId,
            courseId: job.courseId,
            lessonId,
            kind: AssetKind.AUDIO,
            storageKey: clip.storageKey,
            mimeType: clip.mimeType,
            bytes: clip.bytes,
            durationMs: clip.audioMs,
            sourceTaskId: task.id,
          })
          await lessonService.updateSceneVisuals(tx, clip.sceneId, {
            audioAssetId: asset.id,
            durationMs: clip.audioMs + clip.pauseAfterMs,
          })
        }
        const captions = await assetService.upsertAsset(tx, {
          organizationId: job.organizationId,
          courseId: job.courseId,
          lessonId,
          kind: AssetKind.CAPTIONS,
          storageKey: captionsKey,
          mimeType: 'text/vtt',
          bytes: vtt.byteLength,
          durationMs: totalMs,
          sourceTaskId: task.id,
        })
        await lessonService.updateVersionNarration(tx, written.versionId, {
          captionsAssetId: captions.id,
          narrationDurationMs: totalMs,
        })
      },
      { timeout: 30_000 }
    )

    return { output: { scenes: voiced.length, durationMs: totalMs, voice: spokenVoice } }
  },
}
