import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: briefWriterAgent, Brief Writer, book-first course,
 *   brief from book, autopilot course
 *
 * WHAT:  Writes the course brief (topic, description, audience, level,
 *        language, teaching style, length) from the course book's outline and
 *        opening pages, then saves it on the course.
 * WHY:   Book-first courses ask the author for nothing but the PDF; the book
 *        already says what it covers and who it is for. Length follows the
 *        book's size so the course mirrors the chapters at a sensible depth.
 *        Includes (exercises, quizzes, project) stay as created. The
 *        author's chosen learner level and refinements (audienceProfile)
 *        are kept, and the audience text is written for that level; a
 *        teaching style the author typed wins over the suggested one.
 * WHERE: Registered as `briefWriter`; first task of a book-first PLAN_COURSE
 *        job (before research and the curriculum).
 */

import { AiCapability } from '@/generated/prisma'
import { COURSE_DURATION_LIMITS, bookBriefSchema } from '@/lib/types'
import { learnerLevelGuide } from '@/lib/config/learner-levels'
import * as courseService from '@/services/course.service'
import * as courseBookService from '@/services/course-book.service'
import { AgentInputError } from '@/lib/generation/errors'
import { defineAgent } from './define-agent'
import { courseAgentInputSchema, describeBookOutlineForPrompt, loadBookOutline, loadCourseForAgent } from './course-context'

const OPENING_CHARS = 8_000
const MAX_MINUTES = 900

export const briefWriterAgent = defineAgent({
  name: 'Brief Writer',
  description: 'Writes the course brief from the course book',
  capability: AiCapability.STRONG_REASONING,
  inputSchema: courseAgentInputSchema,
  outputSchema: bookBriefSchema,
  schemaName: 'course_brief',
  temperature: 0.3,
  maxOutputTokens: 2_000,

  loadContext: async (db, input, job) => {
    const { brief } = await loadCourseForAgent(db, job.organizationId, input.courseId)
    const book = await loadBookOutline(db, input.courseId)
    if (!book) throw new AgentInputError('This course has no course book chapters to plan from.')
    const pages = book.reduce((sum, chapter) => sum + chapter.endPage - chapter.startPage + 1, 0)
    const [first] = await courseBookService.listSelectedChapters(db, input.courseId)
    const opening = (first?.pages ?? []).join('\n').slice(0, OPENING_CHARS)
    return { brief, book, pages, opening }
  },

  buildMessages: ({ brief, book, pages, opening }) => [
    {
      role: 'system',
      content: [
        'You turn a course book into the brief for an online video course that teaches it.',
        'Rules:',
        '- `topic` is a clear course title based on the book (e.g. "ACCA Financial Accounting (FA)"), 3 to 120 characters.',
        '- `description` summarises what the course covers and its goal in 2 to 4 sentences.',
        '- `audience` names who the book is written for (e.g. "ACCA students preparing for the FA exam").',
        '- `difficulty` is beginner, intermediate or advanced, judged from the book.',
        '- `language` is the language the book is written in.',
        '- `teachingStyle` suits the subject (exam texts: "Exam focused, with worked examples").',
        `- \`targetDurationMinutes\` is about 1 minute of video per page taught, between ${COURSE_DURATION_LIMITS.minMinutes} and ${MAX_MINUTES}. This book has ${pages} pages in the chapters being taught.`,
        '- Use only what the book shows; do not invent an exam body or edition that is not in it.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Current working title: ${brief.topic}`,
        `The author chose this learner level: ${learnerLevelGuide(brief.audienceProfile.level).label} (${learnerLevelGuide(brief.audienceProfile.level).summary}). Write \`audience\` for these learners and set \`teachingStyle\` and \`targetDurationMinutes\` to suit them.`,
        brief.teachingStyle ? `The author asked for this teaching style: ${brief.teachingStyle}` : '',
        '',
        'Chapters being taught (refs, pages, topics):',
        describeBookOutlineForPrompt(book),
        '',
        'Opening text of the first chapter:',
        opening,
      ].join('\n'),
    },
  ],

  persist: async (db, { output, context, execution }) => {
    const { organizationId, courseId } = execution.job
    const minutes = Math.min(MAX_MINUTES, Math.max(COURSE_DURATION_LIMITS.minMinutes, output.targetDurationMinutes))
    await courseService.updateCourse(db, organizationId, courseId, {
      title: output.topic,
      brief: { ...context.brief, ...output, teachingStyle: context.brief.teachingStyle || output.teachingStyle, targetDurationMinutes: minutes },
    })
    return { topic: output.topic, minutes, audience: output.audience }
  },
})
