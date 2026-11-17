import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: voiceService, listVoiceProfiles,
 *   upsertVoiceProfile, VoiceProfile, aiModelId, voice per model
 *
 * WHAT:  Pure Prisma for the workspace's narration voices, one per TTS model.
 * WHY:   Voice ids only work on their own model, so each model keeps its own
 *        voice, speed and style; the narrator reads them all and the gateway
 *        picks the one for whichever model speaks. Kept separate from
 *        provider/model rows because a voice is a property of the course's
 *        sound, not of the connection.
 * WHERE: aiProviders router (voice section); narrator agent.
 */

import type { DbClient } from '@/lib/config'

const VOICE_PROFILE_SELECT = { id: true, aiModelId: true, voice: true, speed: true, instructions: true } as const

export function listVoiceProfiles(db: DbClient, organizationId: string) {
  return db.voiceProfile.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' }, select: VOICE_PROFILE_SELECT })
}

export function upsertVoiceProfile(
  db: DbClient,
  organizationId: string,
  data: { aiModelId: string; voice: string; speed: number; instructions: string }
) {
  return db.voiceProfile.upsert({
    where: { organizationId_aiModelId: { organizationId, aiModelId: data.aiModelId } },
    update: { voice: data.voice, speed: data.speed, instructions: data.instructions },
    create: { organizationId, name: 'Narrator', isDefault: true, ...data },
    select: VOICE_PROFILE_SELECT,
  })
}
