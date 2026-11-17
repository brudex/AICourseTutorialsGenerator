-- AlterEnum
ALTER TYPE "ProviderKind" ADD VALUE 'ELEVENLABS';

-- AlterTable
ALTER TABLE "voice_profile" ADD COLUMN     "aiModelId" TEXT;

-- CreateIndex
CREATE INDEX "voice_profile_aiModelId_idx" ON "voice_profile"("aiModelId");

-- AddForeignKey
ALTER TABLE "voice_profile" ADD CONSTRAINT "voice_profile_aiModelId_fkey" FOREIGN KEY ("aiModelId") REFERENCES "ai_model"("id") ON DELETE SET NULL ON UPDATE CASCADE;
