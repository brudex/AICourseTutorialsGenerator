-- Voices are now saved per TTS model. Attach each workspace's existing voice
-- to the model currently routed to Narration; workspaces without a route keep
-- a null aiModelId, which still applies to every model.
UPDATE "voice_profile" AS vp
SET "aiModelId" = cr."modelId"
FROM "capability_route" AS cr
WHERE vp."aiModelId" IS NULL
  AND cr."organizationId" = vp."organizationId"
  AND cr."capability" = 'TTS';

-- DropIndex
DROP INDEX "voice_profile_organizationId_idx";

-- CreateIndex
CREATE UNIQUE INDEX "voice_profile_organizationId_aiModelId_key" ON "voice_profile"("organizationId", "aiModelId");
