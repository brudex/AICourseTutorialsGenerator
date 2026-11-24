import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: lessonWriterAgent, Lesson Writer, LessonContent,
 *   LessonVersion, lesson notes
 *
 * WHAT:  Writes one lesson's structured content (blueprint §10) — the
 *        readable notes and the source material the Video Director turns into
 *        scenes — and stores it as a new LessonVersion.
 * WHY:   Each lesson is generated independently (parallel in the DAG) but
 *        with its neighbours and the course outcomes in view, so lessons
 *        connect instead of repeating each other. Book-based courses teach
 *        from the lesson's own book pages (describeBookExcerptForPrompt). Writes a NEW version every
 *        time (never overwrites) and moves currentVersionId; approval of that
 *        version is decided later by QA.
 * WHERE: Registered as `lessonWriter`; first task per lesson in BUILD_COURSE.
 */

import { AiCapability, LessonStatus, VersionSource } from '@/generated/prisma'
import { lessonContentSchema, type ChatMessage } from '@/lib/types'
import * as lessonService from '@/services/lesson.service'
import { defineAgent } from './define-agent'
import {
  describeBookExcerptForPrompt,
  describeBriefForPrompt,
  describeDossierForPrompt,
  describeLessonPlacement,
  describeOutcomesForPrompt,
  lessonAgentInputSchema,
  loadLessonContext,
  type LessonAgentContext,
} from './course-context'

export const lessonWriterAgent = defineAgent({
  name: 'Lesson Writer',
  description: 'Writes the lesson: hook, explanations, analogies, examples, code, mistakes, summary',
  capability: AiCapability.STRONG_REASONING,
  inputSchema: lessonAgentInputSchema,
  outputSchema: lessonContentSchema,
  schemaName: 'lesson_content',
  temperature: 0.5,
  maxOutputTokens: 8_000,
  lessonIdOf: (input) => input.lessonId,

  loadContext: (db, input, job) => loadLessonContext(db, job.organizationId, input),

  buildMessages: (context) =>
    context.lesson.kind === 'WELCOME' ? welcomeMessages(context) : lessonMessages(context),

  persist: async (db, { input, output, execution }) => {
    const version = await lessonService.createLessonVersion(db, {
      organizationId: execution.job.organizationId,
      lessonId: input.lessonId,
      content: output,
      source: VersionSource.AI,
      createdByTaskId: execution.task.id,
    })
    await lessonService.setCurrentLessonVersion(db, input.lessonId, version.id, LessonStatus.GENERATING)
    return { versionId: version.id, version: version.version, sections: output.sections.length }
  },
})

/* The course welcome lecture: orientation, not teaching (docs/11 §1). */
function welcomeMessages(context: LessonAgentContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are the instructor of a professional online course, writing its opening "Welcome" lecture (about 2 minutes).',
        'Sections, in order: hook (why this skill matters to this audience) → explanation (what the course covers, section by section, in one or two sentences each) → example (what the learner will be able to build or do by the end) → explanation headed "How to get the most from this course" (watch the videos, pause for exercises, take the quizzes, use the downloads, build the final project if there is one) → summary (an encouraging invitation to start).',
        'Rules: do not teach any topic content yet; be warm, specific, and honest; no hype. `objectives` describe what the learner will know about the course after watching. Write in the requested language.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Course brief:',
        describeBriefForPrompt(context.brief),
        '',
        `Course title: ${context.course.title}`,
        context.course.goal ? `Course goal: ${context.course.goal}` : '',
        'Learning outcomes:',
        describeOutcomesForPrompt(context.outcomes, []),
      ].join('\n'),
    },
  ]
}

function lessonMessages(context: LessonAgentContext): ChatMessage[] {
  return [
    {
      role: 'system',
      content: [
        'You are an expert instructor writing one lesson of a professional online course.',
        'Write the lesson as ordered, typed sections. Use this flow, adapting it to the topic:',
        'hook → explanation → analogy → example → code_demo (only if writing code is part of what this course teaches) → illustration_request (1–3 visuals that genuinely aid understanding) → common_mistakes → summary → further_learning.',
        'Rules:',
        '- Teach exactly the scope of this lesson. Briefly connect to the previous lesson and set up the next; do not re-teach earlier lessons or jump ahead.',
        '- `objectives` are 1–4 concrete, observable things the learner can do after this lesson, aligned to the outcomes marked "(this lesson)".',
        '- Explanations are clear, concrete, and pitched at the stated audience and level. Prefer short paragraphs.',
        '- Code samples only for courses that teach programming (or whose brief asks for code). In a maths, science or business course, never write code to draw a graph or chart: ask for the graph itself with an illustration_request.',
        '- Every code sample must be complete, correct, and runnable as shown; use current, non-deprecated APIs.',
        '- `illustration_request.prompt` describes precisely what the visual must show (elements, labels, arrows), not a style. For a graph of a function, give the formula in x, the x range, and the points, holes and asymptotes to mark.',
        '- `common_mistakes` lists real mistakes for this exact topic with the fix for each.',
        '- Length: content a learner can work through in about the lesson’s stated minutes.',
        '- Write all text in the requested language.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Course brief:',
        describeBriefForPrompt(context.brief),
        '',
        'Course learning outcomes:',
        describeOutcomesForPrompt(context.outcomes, context.lesson.objectiveRefs),
        '',
        'Where this lesson sits:',
        describeLessonPlacement(context),
        '',
        context.dossier ? `Research dossier:\n${describeDossierForPrompt(context.dossier)}` : '',
        '',
        describeBookExcerptForPrompt(context.bookExcerpt),
      ].join('\n'),
    },
  ]
}
