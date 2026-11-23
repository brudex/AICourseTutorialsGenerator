-- AlterTable
ALTER TABLE "ai_model" ADD COLUMN     "voices" TEXT[] DEFAULT ARRAY[]::TEXT[];
