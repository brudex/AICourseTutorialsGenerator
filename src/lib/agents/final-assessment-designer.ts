import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: finalAssessmentDesignerAgent, Final Assessment
 *   Designer, final exam, outcome coverage
 *
 * WHAT:  Writes the course's final assessment (10–20 questions) with at least
 *        one question per learning outcome, stored as course-level items.
 * WHY:   The quality bar requires every outcome to be assessed (docs/11 §1).
 *        The prompt names every outcome id; any still missing are reported
 *        on the task output and fail the readiness check, so a gap is visible
 *        rather than silently shipped.
 * WHERE: Registered as `finalAssessmentDesigner`; one task per BUILD_COURSE
 *        (when quizzes are included), after every lesson is written.
 */

import { AiCapability } from '@/generated/prisma'
import { assessmentSetSchema, learningOutcomeSchema } from '@/lib/types'
import * as lessonService from '@/services/lesson.service'
import { AgentInputError } from '@/lib/generation/errors'
import { defineAgent } from './define-agent'
import {
  courseAgentInputSchema,
  describeBriefForPrompt,
  describeLessonsForPrompt,
  describeOutcomesForPrompt,
  loadCourseForAgent,
} from './course-context'

export const finalAssessmentDesignerAgent = defineAgent({
  name: 'Final Assessment Designer',
  description: 'Writes the final assessment covering every learning outcome',
  capability: AiCapability.STRONG_REASONING,
  inputSchema: courseAgentInputSchema,
  outputSchema: assessmentSetSchema,
  schemaName: 'final_assessment',
  temperature: 0.3,
  maxOutputTokens: 12_000,

  loadContext: async (db, input, job) => {
    const { course, brief } = await loadCourseForAgent(db, job.organizationId, input.courseId)
    const outcomes = learningOutcomeSchema.array().safeParse(course.outcomes)
    if (!outcomes.success || outcomes.data.length === 0) throw new AgentInputError('The course has no learning outcomes.')
    const lessons = await lessonService.listLessonContents(db, input.courseId)
    return { brief, outcomes: outcomes.data, lessons }
  },

  buildMessages: ({ brief, outcomes, lessons }) => [
    {
      role: 'system',
      content: [
        'You write the final assessment of a professional online course.',
        `Write 10–20 questions. Include at least one question for EVERY learning outcome (${outcomes.map((o) => o.id).join(', ')}), weighted toward the most important ones.`,
        'Mix difficulties (some EASY, mostly MEDIUM, some HARD) and types (MULTIPLE_CHOICE, SCENARIO, MULTIPLE_RESPONSE, TRUE_FALSE, FILL_BLANK).',
        'Prefer realistic scenarios that test applying the skills, not recalling wording.',
        'Option ids are short (a, b, c, d); answer keys match option ids exactly; every explanation teaches.',
        'Write all text in the requested language.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Course brief:',
        describeBriefForPrompt(brief),
        '',
        'Learning outcomes:',
        describeOutcomesForPrompt(outcomes, outcomes.map((o) => o.id)),
        '',
        'What the course taught:',
        describeLessonsForPrompt(lessons),
      ].join('\n'),
    },
  ],

  persist: async (db, { output, context, execution }) => {
    const valid = new Set(context.outcomes.map((o) => o.id))
    const covered = new Set(output.items.map((i) => i.objectiveRef).filter((r) => valid.has(r)))
    const missing = context.outcomes.filter((o) => !covered.has(o.id)).map((o) => o.id)
    const fallback = context.outcomes[0]?.id ?? ''
    await lessonService.supersedeFinalAssessments(
      db,
      execution.job.courseId,
      output.items.map((item, position) => ({
        organizationId: execution.job.organizationId,
        courseId: execution.job.courseId,
        objectiveRef: valid.has(item.objectiveRef) ? item.objectiveRef : fallback,
        type: item.content.type,
        difficulty: item.difficulty,
        position,
        content: item.content,
        createdByTaskId: execution.task.id,
      }))
    )
    return { questions: output.items.length, outcomesMissing: missing }
  },
})
