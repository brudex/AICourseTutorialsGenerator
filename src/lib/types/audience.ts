/**
 * SOURCE OF TRUTH KEYWORDS: LEARNER_LEVELS, learnerLevelSchema, LearnerLevel,
 *   audienceProfileSchema, AudienceProfile, AUDIENCE_AGE_LIMITS,
 *   AUDIENCE_TEXT_LIMITS, LearnerLevelGuide, audience specialization,
 *   toddlers to PhD
 *
 * WHAT:  The audience specialization contract: the eight learner levels a
 *        course can be pitched at (toddlers to PhD and professionals), the
 *        author's optional refinements (age range, prior knowledge, learning
 *        goals), and the shape of a level's teaching guide.
 * WHY:   The level is chosen before anything is generated and stored on the
 *        brief, so every agent (outline, lesson, video script, illustration,
 *        narration, assessment, QA) reads the same profile. Refinements use
 *        `.nullable()` / empty strings rather than `.optional()` so React Hook
 *        Form input and output types match. The guide's content lives in
 *        src/lib/config/learner-levels.ts; only its shape lives here.
 * WHERE: CourseBrief.audienceProfile (course-content.ts), new-course forms,
 *        AudienceProfileFields, describeBriefForPrompt, Curriculum Architect,
 *        Narrator, Illustrator. Re-exported via src/lib/types.
 */

import { z } from 'zod'

export const LEARNER_LEVELS = [
  'toddlers',
  'juniors',
  'seniors',
  'undergraduates',
  'graduates',
  'masters',
  'phd',
  'professionals',
] as const
export const learnerLevelSchema = z.enum(LEARNER_LEVELS)
export type LearnerLevel = z.infer<typeof learnerLevelSchema>

export const AUDIENCE_AGE_LIMITS = { min: 1, max: 99 } as const
export const AUDIENCE_TEXT_LIMITS = { priorKnowledge: 300, learningGoals: 600 } as const

const ageSchema = z.number().int().min(AUDIENCE_AGE_LIMITS.min).max(AUDIENCE_AGE_LIMITS.max).nullable()

export const audienceProfileSchema = z
  .object({
    level: learnerLevelSchema,
    ageMin: ageSchema,
    ageMax: ageSchema,
    priorKnowledge: z.string().trim().max(AUDIENCE_TEXT_LIMITS.priorKnowledge),
    learningGoals: z.string().trim().max(AUDIENCE_TEXT_LIMITS.learningGoals),
  })
  .refine((p) => p.ageMin === null || p.ageMax === null || p.ageMin <= p.ageMax, 'The youngest age must not be above the oldest.')

export type AudienceProfile = z.infer<typeof audienceProfileSchema>

/** Minutes for one lecture video at a level (the global 20 minute cap still applies). */
export interface LectureMinutes {
  min: number
  typical: number
  max: number
}

/**
 * SOURCE OF TRUTH KEYWORDS: LearnerLevelGuide, level teaching guide,
 *   narration delivery, illustration style per level
 * WHAT:  How to teach one learner level. Each prompt field is written as an
 *        instruction to the model; `narration` adjusts the voice; `ages` is
 *        the default age range shown in the form.
 */
export interface LearnerLevelGuide {
  label: string
  summary: string
  ages: { min: number; max: number } | null
  lectureMinutes: LectureMinutes
  language: string
  methodology: string
  examples: string
  structure: string
  assessments: string
  depth: string
  illustrationStyle: string
  /** Pictures per lecture when an image model is routed (capped by MAX_ILLUSTRATIONS_PER_LESSON). */
  illustrations: { min: number; max: number }
  narration: { speedFactor: number; delivery: string }
  teachingStyles: readonly string[]
}
