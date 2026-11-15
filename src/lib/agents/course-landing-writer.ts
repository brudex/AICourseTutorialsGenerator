import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS:⁠​‌‌​​‌‌​​‌​‌‌‌​​‌‌​‌​​​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​‌‌‌‌​​​‌​​‌​‌​​​‌​​‌‌‌⁠ courseLandingWriterAgent, Course Landing writer,
 *   courseLandingSchema, landing page copy, what you'll learn
 *
 * WHAT:  Writes the course's learner-facing landing copy (docs/11 §1): title,
 *        subtitle, description, "What you'll learn", requirements, and who the
 *        course is for.
 * WHY:   A professional course is sold and introduced by this page. It is
 *        written from the APPROVED curriculum (outcomes + modules), so it
 *        promises exactly what the course teaches. Runs in parallel with
 *        lesson generation since it needs only the plan.
 * WHERE: Registered as `courseLandingWriter`; one task per BUILD_COURSE job.
 */

import { AiCapability } from '@/generated/prisma'
import { courseLandingSchema, learningOutcomeSchema } from '@/lib/types'
import * as courseService from '@/services/course.service'
import { AgentInputError } from '@/lib/generation/errors'
import { defineAgent } from './define-agent'
import { courseAgentInputSchema, describeBriefForPrompt, loadCourseForAgent } from './course-context'

export const courseLandingWriterAgent = defineAgent({
  name: 'Course Landing Writer',
  description: 'Writes the landing page: title, subtitle, description, what you’ll learn',
  capability: AiCapability.FAST_TEXT,
  inputSchema: courseAgentInputSchema,
  outputSchema: courseLandingSchema,
  schemaName: 'course_landing',
  temperature: 0.6,
  maxOutputTokens: 3_000,

  loadContext: async (db, input, job) => {
    const { brief } = await loadCourseForAgent(db, job.organizationId, input.courseId)
    const course = await courseService.findCourseWithCurriculum(db, job.organizationId, input.courseId)
    if (!course || course.modules.length === 0) throw new AgentInputError('The course has no curriculum yet.')
    const outcomes = learningOutcomeSchema.array().safeParse(course.outcomes)
    return { brief, course, outcomes: outcomes.success ? outcomes.data : [] }
  },

  buildMessages: ({ brief, course, outcomes }) => [
    {
      role: 'system',
      content: [
        'You write the landing page for a professional online course on a marketplace.',
        'Rules:',
        '- `title`: specific and benefit-led, at most 60 characters.',
        '- `subtitle`: one sentence, at most 120 characters, saying what the learner will be able to do.',
        '- `description`: 3–5 short paragraphs (plain text, no markdown headings): the problem, what the course covers, how it teaches (videos, demos, exercises, quizzes, project), and the outcome.',
        '- `whatYouWillLearn`: 4–10 concrete outcomes starting with a verb, matching the curriculum — promise nothing it does not teach.',
        '- `requirements`: what a learner needs beforehand (knowledge, tools); say so plainly if there are none beyond a computer.',
        '- `targetAudience`: 1–6 specific descriptions of who the course is for.',
        '- Honest and specific; no hype words ("ultimate", "master in 1 hour").',
        '- Write all text in the requested language.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Course brief:',
        describeBriefForPrompt(brief),
        '',
        `Course goal: ${course.goal ?? '(none)'}`,
        `Learning outcomes:\n${outcomes.map((o) => `- ${o.text}`).join('\n')}`,
        `Prerequisites: ${course.prerequisites.join('; ') || '(none)'}`,
        'Curriculum:',
        course.modules
          .map((m, i) => `Module ${i + 1}: ${m.title}\n${m.lessons.map((l) => `  - ${l.title} (${l.estimatedMinutes} min)`).join('\n')}`)
          .join('\n'),
      ].join('\n'),
    },
  ],

  persist: async (db, { output, execution }) => {
    await courseService.updateCourse(db, execution.job.organizationId, execution.job.courseId, {
      title: output.title,
      subtitle: output.subtitle,
      description: output.description,
      whatYouWillLearn: output.whatYouWillLearn,
      requirements: output.requirements,
      targetAudience: output.targetAudience,
    })
    return { title: output.title, learnItems: output.whatYouWillLearn.length }
  },
})
