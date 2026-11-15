import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: cheatSheetWriterAgent, Cheat Sheet Writer,
 *   cheatSheetSchema, quick reference, Course.cheatSheet
 *
 * WHAT:  Condenses the whole written course into a one-to-two page quick
 *        reference (sections of key points with short code snippets) and
 *        stores it on Course.cheatSheet.
 * WHY:   A cheat sheet is a standard Udemy-style download (docs/11 §1). It is
 *        written after every lesson so it summarises exactly what was taught.
 *        The PDF itself is rendered later by the materials builder, so the
 *        layout can change without another model call.
 * WHERE: Registered as `cheatSheetWriter`; in BUILD_COURSE after all lessons,
 *        and first in BUILD_MATERIALS jobs.
 */

import { AiCapability } from '@/generated/prisma'
import { cheatSheetSchema } from '@/lib/types'
import * as courseService from '@/services/course.service'
import * as lessonService from '@/services/lesson.service'
import { AgentInputError } from '@/lib/generation/errors'
import { defineAgent } from './define-agent'
import {
  courseAgentInputSchema,
  describeBriefForPrompt,
  describeLessonsForPrompt,
  loadCourseForAgent,
  loadLatestDossier,
} from './course-context'

export const cheatSheetWriterAgent = defineAgent({
  name: 'Cheat Sheet Writer',
  description: 'Condenses the course into a one page quick reference',
  capability: AiCapability.FAST_TEXT,
  inputSchema: courseAgentInputSchema,
  outputSchema: cheatSheetSchema,
  schemaName: 'cheat_sheet',
  temperature: 0.3,
  maxOutputTokens: 4_000,

  loadContext: async (db, input, job) => {
    const { course, brief } = await loadCourseForAgent(db, job.organizationId, input.courseId)
    const [lessons, dossier] = await Promise.all([
      lessonService.listLessonContents(db, input.courseId),
      loadLatestDossier(db, input.courseId),
    ])
    if (lessons.length === 0) throw new AgentInputError('No lessons have been written yet.')
    return { course, brief, lessons, dossier }
  },

  buildMessages: ({ course, brief, lessons, dossier }) => [
    {
      role: 'system',
      content: [
        'You write the printable cheat sheet of a professional online course: a dense quick reference a learner keeps beside them.',
        'Rules:',
        '- 4–10 sections in course order; each heading names a concept, not a lecture number.',
        '- Points are terse reference lines (syntax, rules, defaults, gotchas), not explanations; at most 8 per section.',
        '- Add a `code` snippet only where the topic involves code: the shortest correct example of the idiom (a few lines), otherwise null.',
        '- Use only what the course taught; current, non-deprecated APIs.',
        '- `title` is a short name such as "<topic> cheat sheet".',
        '- Write all text in the requested language.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Course brief:',
        describeBriefForPrompt(brief),
        '',
        `Course title: ${course.title}`,
        'What the course taught:',
        describeLessonsForPrompt(lessons),
        '',
        dossier ? `Key concepts:\n${dossier.keyConcepts.map((c) => `- ${c.name}`).join('\n')}` : '',
      ].join('\n'),
    },
  ],

  persist: async (db, { output, execution }) => {
    await courseService.updateCourse(db, execution.job.organizationId, execution.job.courseId, { cheatSheet: output })
    return { title: output.title, sections: output.sections.length }
  },
})
