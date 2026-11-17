import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: voiceService, findDefaultVoice,
 *   upsertDefaultVoice, VoiceProfile, aiModelId
 *
 * WHAT:  Pure Prisma for the workspace's default narration voice.
 * WHY:   One default profile per workspace today; the narrator reads it, the
 *        AI Providers page edits it. Kept separate from provider/model rows
 *        because a voice is a property of the course's sound, not of the
 *        connection.
 * WHERE: aiProviders router (voice section); narrator agent.
 */

import type { DbClient } from '@/lib/config'

export function findDefaultVoice(db: DbClient, organizationId: string) {
  return db.voiceProfile.findFirst({
    where: { organizationId, isDefault: true },
    select: { id: true, name: true, aiModelId: true, voice: true, speed: true, instructions: true },
  })
}

export async function upsertDefaultVoice(
  db: DbClient,
  organizationId: string,
  data: { aiModelId: string | null; voice: string; speed: number; instructions: string }
) {
  const existing = await findDefaultVoice(db, organizationId)
  return existing
    ? db.voiceProfile.update({ where: { id: existing.id }, data, select: { id: true, voice: true } })
    : db.voiceProfile.create({
        data: { organizationId, name: 'Default narrator', isDefault: true, ...data },
        select: { id: true, voice: true },
      })
}
