import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS:⁠​‌‌​​‌‌​​‌​‌‌‌​​‌‌​‌​​​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​‌‌‌‌​​​‌​​‌​‌​​​‌​​‌‌‌⁠ assessmentDesignerAgent, Assessment Designer,
 *   assessmentSetSchema, lesson quiz
 *
 * WHAT:  Writes the lesson quiz (blueprint §18): 3–5 mixed-type questions,
 *        each tied to a learning outcome, with answer and explanation.
 * WHY:   Every question must reference one of the lesson's outcomes so the
 *        course-level quality report can prove each outcome is assessed. The
 *        schema's superRefine rejects answer keys that point at missing
 *        options; persist additionally drops items whose objectiveRef is not a
 *        real course outcome (re-pointing them at the lesson's first outcome).
 * WHERE: Registered as `assessmentDesigner`; after lessonWriter per lesson,
 *        when the brief includes quizzes.
 */

import { AiCapability } from '@/generated/prisma'
import { assessmentSetSchema } from '@/lib/types'
import * as lessonService from '@/services/lesson.service'
import { AgentInputError } from '@/lib/generation/errors'
import { defineAgent } from './define-agent'
import {
  describeBriefForPrompt,
  describeBookExcerptForPrompt,
  describeLessonContentForPrompt,
  describeOutcomesForPrompt,
  lessonAgentInputSchema,
  loadCurrentLessonContent,
  loadLessonContext,
} from './course-context'

export const assessmentDesignerAgent = defineAgent({
  name: 'Assessment Designer',
  description: 'Writes the lesson quiz, each question tied to a learning outcome',
  capability: AiCapability.FAST_TEXT,
  inputSchema: lessonAgentInputSchema,
  outputSchema: assessmentSetSchema,
  schemaName: 'assessment_set',
  temperature: 0.3,
  maxOutputTokens: 8_000,
  lessonIdOf: (input) => input.lessonId,

  loadContext: async (db, input, job) => {
    const context = await loadLessonContext(db, job.organizationId, input)
    const written = await loadCurrentLessonContent(db, input.lessonId)
    return { ...context, written }
  },

  buildMessages: (context) => [
    {
      role: 'system',
      content: [
        'You write the quiz for one lesson of a professional online course.',
        'Write 3–5 questions. Mix types: mostly MULTIPLE_CHOICE, plus at least one of TRUE_FALSE, MULTIPLE_RESPONSE, FILL_BLANK, or SCENARIO.',
        'Rules:',
        '- Test understanding and application of THIS lesson, not trivia or wording.',
        '- `objectiveRef` must be one of the outcome ids marked "(this lesson)".',
        '- Option ids are short (a, b, c, d); the answer key must match an option id exactly.',
        '- Distractors are plausible misconceptions (use the lesson’s common mistakes), never jokes.',
        '- FILL_BLANK text marks each blank as ___ with one answer per blank.',
        '- Every `explanation` says why the right answer is right and why the tempting wrong one is wrong.',
        '- Write all text in the requested language.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Course brief:',
        describeBriefForPrompt(context.brief),
        '',
        'Learning outcomes:',
        describeOutcomesForPrompt(context.outcomes, context.lesson.objectiveRefs),
        '',
        `Lesson: ${context.lesson.title}`,
        describeLessonContentForPrompt(context.written.content),
        '',
        describeBookExcerptForPrompt(context.bookExcerpt),
      ].join('\n'),
    },
  ],

  persist: async (db, { input, output, context, execution }) => {
    const validRefs = new Set(context.outcomes.map((o) => o.id))
    const fallbackRef = context.lesson.objectiveRefs.find((r) => validRefs.has(r)) ?? context.outcomes[0]?.id
    if (!fallbackRef) throw new AgentInputError('The course has no learning outcomes to assess.')

    await lessonService.supersedeLessonAssessments(
      db,
      input.lessonId,
      output.items.map((item, position) => ({
        organizationId: execution.job.organizationId,
        courseId: execution.job.courseId,
        lessonId: input.lessonId,
        objectiveRef: validRefs.has(item.objectiveRef) ? item.objectiveRef : fallbackRef,
        type: item.content.type,
        difficulty: item.difficulty,
        position,
        content: item.content,
        createdByTaskId: execution.task.id,
      }))
    )
    return { questions: output.items.length }
  },
})
