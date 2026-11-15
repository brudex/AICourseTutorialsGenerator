import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: exerciseDesignerAgent, Exercise Designer,
 *   exerciseSetSchema, practice activities
 *
 * WHAT:  Creates the lesson's practice activities (blueprint §17): a quick
 *        check and a practice exercise, plus a challenge when it fits — each
 *        with instructions, starter, hints, and a full solution.
 * WHY:   Exercises are written from the lesson's actual content so they
 *        practise exactly what was taught. Persisting supersedes the lesson's
 *        previous active exercises instead of deleting them.
 * WHERE: Registered as `exerciseDesigner`; after lessonWriter per lesson,
 *        when the brief includes exercises.
 */

import { AiCapability } from '@/generated/prisma'
import { exerciseSetSchema } from '@/lib/types'
import * as lessonService from '@/services/lesson.service'
import { defineAgent } from './define-agent'
import {
  describeBriefForPrompt,
  describeBookExcerptForPrompt,
  describeLessonContentForPrompt,
  lessonAgentInputSchema,
  loadCurrentLessonContent,
  loadLessonContext,
} from './course-context'

export const exerciseDesignerAgent = defineAgent({
  name: 'Exercise Designer',
  description: 'Creates practice exercises with starter code, hints, and solutions',
  capability: AiCapability.CODING,
  inputSchema: lessonAgentInputSchema,
  outputSchema: exerciseSetSchema,
  schemaName: 'exercise_set',
  temperature: 0.4,
  maxOutputTokens: 6_000,
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
        'You design practice activities for one lesson of a professional online course.',
        'Create 2–3 exercises: one QUICK_CHECK (2–5 minutes), one PRACTICE (10–20 minutes), and optionally one CHALLENGE (20–40 minutes) if the lesson supports it.',
        'Rules:',
        '- Practise only what this lesson (and earlier lessons) taught.',
        '- Instructions are step-by-step and unambiguous; state what "done" looks like.',
        '- For programming topics: provide `starterCode`, `expectedOutput`, and a complete, correct `solution`; add `tests` when practical. Set `language`.',
        '- For non-programming topics: set code fields to null and make the `solution` a model answer.',
        '- 1–3 progressive `hints` that nudge without giving the answer away.',
        '- Write all text in the requested language.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Course brief:',
        describeBriefForPrompt(context.brief),
        '',
        `Lesson: ${context.lesson.title}`,
        describeLessonContentForPrompt(context.written.content),
        '',
        describeBookExcerptForPrompt(context.bookExcerpt),
      ].join('\n'),
    },
  ],

  persist: async (db, { input, output, execution }) => {
    await lessonService.supersedeLessonExercises(
      db,
      input.lessonId,
      output.exercises.map((exercise, position) => ({
        organizationId: execution.job.organizationId,
        courseId: execution.job.courseId,
        lessonId: input.lessonId,
        level: exercise.level,
        title: exercise.title,
        position,
        content: exercise.content,
        createdByTaskId: execution.task.id,
      }))
    )
    return { exercises: output.exercises.length }
  },
})
