import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: curriculumArchitectAgent, Curriculum Architect,
 *   curriculumSchema, learning outcomes, module plan, replaceCurriculum
 *
 * WHAT:  Designs the course structure (blueprint §9) from the brief and the
 *        research dossier, then writes it as Course outcomes + Module rows +
 *        PLANNED Lesson rows for the user to edit and approve.
 * WHY:   Runs only before approval, so persisting REPLACES any existing
 *        modules (a regenerate gives a fresh plan). Model output is
 *        sanitised rather than trusted: objective references that point at
 *        outcomes the model didn't define are dropped (a lesson left with
 *        none inherits its module's), and module minutes are recomputed from
 *        lessons so durations always add up.
 *        Book-based courses mirror the book: one module per ticked chapter,
 *        in book order, each lesson covering a page range of its chapter.
 *        Chapter refs the model invents are dropped and page ranges are
 *        clamped into their chapter, so a lesson can never point outside it.
 *        No lecture exceeds the learner level's lecture length (never above
 *        LECTURE_LIMITS.maxMinutes, 20): longer ones are split into parts
 *        (splitLongLessons). Toddlers get 2 to 6 minute videos, PhD
 *        researchers up to 20 (src/lib/config/learner-levels.ts).
 * WHERE: Registered as `curriculumArchitect`; second task of PLAN_COURSE.
 */

import { AiCapability, LessonStatus } from '@/generated/prisma'
import { LECTURE_LIMITS, curriculumSchema, type CurriculumLesson, type LectureMinutes } from '@/lib/types'
import { lectureMinutesFor } from '@/lib/config/learner-levels'
import * as courseService from '@/services/course.service'
import { AgentInputError } from '@/lib/generation/errors'
import { defineAgent } from './define-agent'
import {
  courseAgentInputSchema,
  describeBookOutlineForPrompt,
  describeBriefForPrompt,
  describeDossierForPrompt,
  loadBookOutline,
  loadCourseForAgent,
  loadLatestDossier,
  type BookOutline,
} from './course-context'

/**
 * SOURCE OF TRUTH KEYWORDS: splitLongLessons, lecture split, Part 1 Part 2
 * WHAT:  Splits any planned lesson longer than the level's lecture cap into
 *        equal consecutive parts ("Title (Part 1 of 3)"), sharing its minutes
 *        and its book pages between them.
 * WHY:   The prompt asks for short lectures, but the cap must hold even when
 *        the model ignores it.
 */
function splitLongLessons(lessons: readonly CurriculumLesson[], maxMinutes: number): CurriculumLesson[] {
  return lessons.flatMap((lesson) => {
    const parts = Math.ceil(lesson.estimatedMinutes / maxMinutes)
    if (parts <= 1) return [lesson]
    const { bookStartPage: start, bookEndPage: end } = lesson
    const pages = start !== null && end !== null && end >= start ? end - start + 1 : 0
    return Array.from({ length: parts }, (_, i) => {
      const from = pages > 0 && start !== null ? start + Math.floor((pages * i) / parts) : null
      const to = pages > 0 && start !== null ? Math.max(from ?? start, start + Math.floor((pages * (i + 1)) / parts) - 1) : null
      return {
        ...lesson,
        title: `${lesson.title} (Part ${i + 1} of ${parts})`.slice(0, 200),
        estimatedMinutes: Math.round(lesson.estimatedMinutes / parts),
        bookStartPage: from,
        bookEndPage: to,
      }
    })
  })
}

/* Structure rules: mirror the course book, or design freely without one. */
function structureRules(book: BookOutline | null, projects: boolean, minutes: LectureMinutes): string[] {
  const project = projects
    ? '- End with a module containing a practical final project that integrates most outcomes.'
    : '- Do not add a final project module.'
  if (!book) {
    return [
      '- Sequence from foundations to application, following the research dossier’s recommended sequence and prerequisites.',
      `- Each lesson is one video of ${minutes.min}–${minutes.max} minutes (usually about ${minutes.typical}) on a single focused topic, never longer. Split a bigger topic into consecutive lessons titled "… (Part 1)", "… (Part 2)". A module is 2–7 lessons.`,
      project,
      '- Set `bookChapterRef`, `bookStartPage` and `bookEndPage` to null.',
    ]
  }
  return [
    '- Mirror the course book: exactly one module per chapter listed below, in the same order. Set the module’s `bookChapterRef` to that chapter’s ref (CH-1, CH-2, …) and base the module title on the chapter title.',
    '- Split each chapter into lessons that follow its topics in order. Each lesson sets `bookStartPage` and `bookEndPage` to the inclusive book pages it teaches, inside its chapter’s page range; together a module’s lessons cover every page of the chapter with no gaps or overlaps.',
    `- Each lesson is one video of ${minutes.min}–${minutes.max} minutes (usually about ${minutes.typical}) on a single focused topic, never longer. Split a bigger topic into consecutive lessons titled "… (Part 1)", "… (Part 2)". A module is 1–12 lessons. Share the total duration across chapters in proportion to their page counts.`,
    projects
      ? '- After the chapters, add one final project module that integrates most outcomes; its `bookChapterRef`, `bookStartPage` and `bookEndPage` are null.'
      : '- Do not add a final project module.',
  ]
}

export const curriculumArchitectAgent = defineAgent({
  name: 'Curriculum Architect',
  description: 'Designs outcomes, modules, lessons, and durations',
  capability: AiCapability.STRONG_REASONING,
  inputSchema: courseAgentInputSchema,
  outputSchema: curriculumSchema,
  schemaName: 'curriculum',
  temperature: 0.4,

  loadContext: async (db, input, job) => {
    const { course, brief } = await loadCourseForAgent(db, job.organizationId, input.courseId)
    const dossier = await loadLatestDossier(db, input.courseId)
    if (!dossier) throw new AgentInputError('No research dossier exists for this course yet.')
    if (course.curriculumApprovedAt) {
      throw new AgentInputError('The curriculum is already approved and cannot be replaced.')
    }
    return { brief, dossier, book: await loadBookOutline(db, input.courseId) }
  },

  buildMessages: ({ brief, dossier, book }) => {
    const target = brief.targetDurationMinutes
    return [
      {
        role: 'system',
        content: [
          'You are an expert instructional designer who builds professional, practical courses.',
          'Design a curriculum from the brief and the research dossier.',
          'Rules:',
          '- Write 3–8 measurable learning outcomes using observable verbs (explain, build, compare, debug — not "understand" or "know"). Number them LO-1, LO-2, … in order.',
          '- Every module and every lesson lists the outcome ids it serves in `objectiveRefs`; use only ids you defined.',
          '- `objectiveRefs` and `lessons` are always non-empty arrays of objects or ids, never null and never a string. Only `bookChapterRef`, `bookStartPage` and `bookEndPage` may be null.',
          ...structureRules(book, brief.includes.projects, lectureMinutesFor(brief.audienceProfile, LECTURE_LIMITS.maxMinutes)),
          `- The sum of all lesson minutes must be within 15% of ${target} minutes.`,
          '- Module `estimatedMinutes` equals the sum of its lessons.',
          '- Titles are concrete and learner-facing ("Updating state without bugs"), not generic ("Lesson 3").',
          '- `assessmentStrategy` says briefly how each outcome will be checked (quizzes, exercises, project).',
          '- Avoid topics the research marks as deprecated, except to warn against them.',
          '- Write all text in the requested language.',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          'Course brief:',
          describeBriefForPrompt(brief),
          '',
          'Research dossier:',
          describeDossierForPrompt(dossier),
          book ? `\nCourse book chapters (refs, pages and topics):\n${describeBookOutlineForPrompt(book)}` : '',
        ].join('\n'),
      },
    ]
  },

  persist: async (db, { output, execution, context }) => {
    const { courseId, organizationId } = execution.job
    const validRefs = new Set(output.outcomes.map((o) => o.id))
    const keepValid = (refs: readonly string[]) => refs.filter((r) => validRefs.has(r))
    const chapters = new Map((context.book ?? []).map((chapter) => [chapter.ref, chapter]))
    const lectureCap = lectureMinutesFor(context.brief.audienceProfile, LECTURE_LIMITS.maxMinutes).max

    await courseService.deleteCurriculumRows(db, courseId)

    let lessonCount = 0
    for (const [moduleIndex, planned] of output.modules.entries()) {
      const mod = { ...planned, lessons: splitLongLessons(planned.lessons, lectureCap) }
      const moduleRefs = keepValid(mod.objectiveRefs)
      const minutes = mod.lessons.reduce((sum, l) => sum + l.estimatedMinutes, 0)
      const chapter = mod.bookChapterRef ? chapters.get(mod.bookChapterRef) ?? null : null
      /* Clamp a lesson's pages into its chapter; null without a chapter. */
      const pagesOf = (start: number | null, end: number | null) => {
        if (!chapter || start === null) return { bookStartPage: null, bookEndPage: null }
        const from = Math.min(Math.max(start, chapter.startPage), chapter.endPage)
        return { bookStartPage: from, bookEndPage: Math.min(Math.max(end ?? from, from), chapter.endPage) }
      }
      const created = await courseService.createModule(db, {
        organizationId,
        courseId,
        position: moduleIndex,
        title: mod.title,
        summary: mod.summary,
        objectiveRefs: moduleRefs,
        estimatedMinutes: minutes,
        bookChapterId: chapter?.id ?? null,
      })
      await courseService.createLessons(
        db,
        mod.lessons.map((lesson, lessonIndex) => {
          const refs = keepValid(lesson.objectiveRefs)
          return {
            organizationId,
            courseId,
            moduleId: created.id,
            position: lessonIndex,
            title: lesson.title,
            objectiveRefs: refs.length > 0 ? refs : moduleRefs,
            estimatedMinutes: lesson.estimatedMinutes,
            status: LessonStatus.PLANNED,
            ...pagesOf(lesson.bookStartPage, lesson.bookEndPage),
          }
        })
      )
      lessonCount += mod.lessons.length
    }

    await courseService.updateCourse(db, organizationId, courseId, {
      goal: output.goal,
      outcomes: output.outcomes,
      prerequisites: output.prerequisites,
      assessmentStrategy: output.assessmentStrategy,
    })

    return {
      modules: output.modules.length,
      lessons: lessonCount,
      outcomes: output.outcomes.length,
      totalMinutes: output.modules.reduce((s, m) => s + m.lessons.reduce((x, l) => x + l.estimatedMinutes, 0), 0),
    }
  },
})
