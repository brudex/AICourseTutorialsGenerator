import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: sectionQuizDesignerAgent, Section Quiz Designer,
 *   section quiz, module assessment
 *
 * WHAT:  Writes the end-of-section quiz (5–8 questions) covering every
 *        lecture in one module, stored as module-level AssessmentItems.
 * WHY:   Udemy-style progression (docs/11 §1): each section ends with a check
 *        that mixes its lectures, so learners consolidate before moving on.
 *        Questions reference the module's outcomes; items pointing at an
 *        outcome outside the course are re-pointed at the module's first.
 * WHERE: Registered as `sectionQuizDesigner`; one task per teaching module in
 *        BUILD_COURSE, after all of that module's lessons are written.
 */

import { AiCapability } from '@/generated/prisma'
import { assessmentSetSchema } from '@/lib/types'
import * as lessonService from '@/services/lesson.service'
import * as courseService from '@/services/course.service'
import { AgentInputError } from '@/lib/generation/errors'
import { defineAgent } from './define-agent'
import {
  describeBriefForPrompt,
  describeLessonsForPrompt,
  describeOutcomesForPrompt,
  loadCourseForAgent,
  moduleAgentInputSchema,
} from './course-context'
import { learningOutcomeSchema } from '@/lib/types'

export const sectionQuizDesignerAgent = defineAgent({
  name: 'Section Quiz Designer',
  description: 'Writes the end-of-section quiz mixing every lecture in the section',
  capability: AiCapability.FAST_TEXT,
  inputSchema: moduleAgentInputSchema,
  outputSchema: assessmentSetSchema,
  schemaName: 'section_quiz',
  temperature: 0.3,
  maxOutputTokens: 6_000,

  loadContext: async (db, input, job) => {
    const { course, brief } = await loadCourseForAgent(db, job.organizationId, input.courseId)
    const mod = await courseService.findModuleInCourse(db, input.courseId, input.moduleId)
    if (!mod) throw new AgentInputError('This section no longer exists.')
    const lessons = await lessonService.listLessonContents(db, input.courseId, input.moduleId)
    if (lessons.length === 0) throw new AgentInputError('This section has no written lectures to quiz.')
    const outcomes = learningOutcomeSchema.array().safeParse(course.outcomes)
    return { brief, mod, lessons, outcomes: outcomes.success ? outcomes.data : [] }
  },

  buildMessages: ({ brief, mod, lessons, outcomes }) => [
    {
      role: 'system',
      content: [
        'You write the end-of-section quiz for one section of a professional online course.',
        'Write 5–8 questions that together cover every lecture listed. Mix types: mostly MULTIPLE_CHOICE and SCENARIO, plus TRUE_FALSE or MULTIPLE_RESPONSE.',
        'Rules:',
        '- Prefer questions that connect ideas across lectures and apply them to a realistic situation.',
        `- \`objectiveRef\` must be one of the outcome ids marked "(this lesson)" (they are this section's outcomes).`,
        '- Option ids are short (a, b, c, d); answer keys match option ids exactly; distractors are real misconceptions.',
        '- Every explanation says why the right answer is right and the tempting wrong one is wrong.',
        '- Write all text in the requested language.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Course brief:',
        describeBriefForPrompt(brief),
        '',
        'Learning outcomes:',
        describeOutcomesForPrompt(outcomes, mod.objectiveRefs),
        '',
        'Lectures in this section:',
        describeLessonsForPrompt(lessons),
      ].join('\n'),
    },
  ],

  persist: async (db, { input, output, context, execution }) => {
    const valid = new Set(context.outcomes.map((o) => o.id))
    const fallback = context.mod.objectiveRefs.find((r) => valid.has(r)) ?? context.outcomes[0]?.id
    if (!fallback) throw new AgentInputError('The course has no learning outcomes to assess.')
    await lessonService.supersedeModuleAssessments(
      db,
      input.moduleId,
      output.items.map((item, position) => ({
        organizationId: execution.job.organizationId,
        courseId: execution.job.courseId,
        moduleId: input.moduleId,
        objectiveRef: valid.has(item.objectiveRef) ? item.objectiveRef : fallback,
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
