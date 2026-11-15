import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: loadCourseForAgent, describeBriefForPrompt,
 *   describeAudienceForPrompt, describeDossierForPrompt, courseAgentInputSchema, agent prompt helpers
 *
 * WHAT:  Shared Course State loading and prompt rendering for agents.
 * WHY:   Every agent sees the brief described the SAME way, so the audience,
 *        level, and language constraints are never phrased differently from
 *        one agent to the next. Stored Json is re-validated on load — a
 *        corrupt brief fails as AgentInputError (non-retryable) instead of
 *        producing a confused prompt.
 *        Lesson agents share loadLessonContext, which adds the course's
 *        outcomes, the research dossier, the lesson, and its neighbours, so
 *        each lesson is written knowing what came before and what comes next.
 *        Book-based courses add the course book: planning agents get the
 *        outline of the ticked chapters (loadBookOutline), lesson agents get
 *        only the pages their lesson teaches (bookExcerpt), so a 600 page
 *        study text never has to fit in one prompt.
 * WHERE: research, curriculumArchitect, and every lesson agent.
 */

import { z } from 'zod'

import type { DbClient } from '@/lib/config'
import { audienceAgeRange, learnerLevelGuide, lectureMinutesFor } from '@/lib/config/learner-levels'
import {
  COURSE_BOOK_LIMITS,
  bookTopicsSchema,
  courseBriefSchema,
  learningOutcomeSchema,
  lessonContentSchema,
  researchDossierContentSchema,
  LECTURE_LIMITS,
  type CourseBrief,
  type LearningOutcome,
  type LessonContent,
  type ResearchDossierContent,
} from '@/lib/types'
import * as courseService from '@/services/course.service'
import * as lessonService from '@/services/lesson.service'
import * as courseBookService from '@/services/course-book.service'
import { AgentInputError } from '@/lib/generation/errors'

export const courseAgentInputSchema = z.object({ courseId: z.string().min(1) })
export type CourseAgentInput = z.infer<typeof courseAgentInputSchema>

export async function loadCourseForAgent(db: DbClient, organizationId: string, courseId: string) {
  const course = await courseService.findCourse(db, organizationId, courseId)
  if (!course) throw new AgentInputError('The course no longer exists.')
  const brief = courseBriefSchema.safeParse(course.brief)
  if (!brief.success) throw new AgentInputError('The course brief is incomplete or invalid. Edit the brief and try again.')
  return { course, brief: brief.data }
}

export async function loadLatestDossier(db: DbClient, courseId: string): Promise<ResearchDossierContent | null> {
  const dossier = await courseService.findLatestDossier(db, courseId)
  if (!dossier) return null
  const parsed = researchDossierContentSchema.safeParse(dossier.content)
  return parsed.success ? parsed.data : null
}

function hours(minutes: number): string {
  return minutes >= 60 ? `${(minutes / 60).toFixed(minutes % 60 === 0 ? 0 : 1)} hours (${minutes} minutes)` : `${minutes} minutes`
}

export function describeBriefForPrompt(brief: CourseBrief): string {
  const includes = [
    brief.includes.exercises ? 'practical exercises' : null,
    brief.includes.quizzes ? 'quizzes' : null,
    brief.includes.projects ? 'hands-on projects' : null,
  ].filter((x): x is string => x !== null)

  return [
    `Topic: ${brief.topic}`,
    brief.description ? `Description from the course author: ${brief.description}` : null,
    `Audience: ${brief.audience}`,
    `Experience with this topic: ${brief.difficulty}`,
    `Language: write everything in ${brief.language}`,
    brief.teachingStyle ? `Preferred teaching style: ${brief.teachingStyle}` : null,
    `Target total duration: ${hours(brief.targetDurationMinutes)}`,
    `Include: ${includes.length > 0 ? includes.join(', ') : 'lessons only'}`,
    '',
    describeAudienceForPrompt(brief),
  ]
    .filter((x): x is string => x !== null)
    .join('\n')
}

/**
 * SOURCE OF TRUTH KEYWORDS: describeAudienceForPrompt, audience
 *   specialization prompt, learner level guide, LEARNER_LEVEL_GUIDES
 *
 * WHAT:  The learner level block every agent sees: who the learners are
 *        (level, ages, prior knowledge, goals) and how to teach them
 *        (language, methodology, examples, structure, assessments, depth).
 * WHY:   Part of describeBriefForPrompt, so outlines, lessons, video scripts,
 *        illustration prompts, quizzes, exercises, projects, the landing page
 *        and QA all adapt to the same audience, phrased the same way.
 * WHERE: describeBriefForPrompt (every content agent).
 */
export function describeAudienceForPrompt(brief: CourseBrief): string {
  const profile = brief.audienceProfile
  const guide = learnerLevelGuide(profile.level)
  const ages = audienceAgeRange(profile)
  const minutes = lectureMinutesFor(profile, LECTURE_LIMITS.maxMinutes)
  return [
    `AUDIENCE SPECIALIZATION (follow this in every part of the course): ${guide.label}${ages ? `, ages ${ages.min} to ${ages.max}` : ''}.`,
    profile.priorKnowledge ? `- Prior knowledge: ${profile.priorKnowledge}` : null,
    profile.learningGoals ? `- Learning goals: ${profile.learningGoals}` : null,
    `- Language and complexity: ${guide.language}`,
    `- Teaching methodology: ${guide.methodology}`,
    `- Examples and scenarios: ${guide.examples}`,
    `- Structure and pacing: ${guide.structure} Lectures are ${minutes.min} to ${minutes.max} minutes, usually about ${minutes.typical}.`,
    `- Assessments: ${guide.assessments}`,
    `- Academic depth: ${guide.depth}`,
    '- The preferred teaching style refines this methodology; it never overrides the level.',
  ]
    .filter((x): x is string => x !== null)
    .join('\n')
}

export function describeDossierForPrompt(dossier: ResearchDossierContent): string {
  const list = (items: readonly string[]) => (items.length > 0 ? items.map((i) => `- ${i}`).join('\n') : '- (none)')
  return [
    `Summary:\n${dossier.summary}`,
    `Key concepts:\n${list(dossier.keyConcepts.map((c) => `${c.name}: ${c.explanation}`))}`,
    `Prerequisites:\n${list(dossier.prerequisites)}`,
    `Recommended teaching sequence:\n${list(dossier.recommendedSequence)}`,
    `Common learner mistakes:\n${list(dossier.commonMistakes)}`,
    `Deprecated or outdated approaches to avoid:\n${list(dossier.deprecatedApproaches)}`,
    `Project ideas:\n${list(dossier.projectIdeas)}`,
    `Researcher caveats (uncertain or time-sensitive):\n${list(dossier.caveats)}`,
  ].join('\n\n')
}

export const lessonAgentInputSchema = z.object({ courseId: z.string().min(1), lessonId: z.string().min(1) })
export type LessonAgentInput = z.infer<typeof lessonAgentInputSchema>

const outcomesSchema = z.array(learningOutcomeSchema)

/**
 * SOURCE OF TRUTH KEYWORDS: loadLessonContext, LessonAgentContext
 *
 * WHAT:  Everything a lesson agent needs about the course and the lesson's
 *        place in it. Throws AgentInputError if the lesson was deleted.
 */
export async function loadLessonContext(db: DbClient, organizationId: string, input: LessonAgentInput) {
  const { course, brief } = await loadCourseForAgent(db, organizationId, input.courseId)
  const lesson = await lessonService.findLessonForAgent(db, input.courseId, input.lessonId)
  if (!lesson) throw new AgentInputError('This lesson no longer exists.')
  const outcomes = outcomesSchema.safeParse(course.outcomes)
  const [dossier, bookExcerpt] = await Promise.all([loadLatestDossier(db, input.courseId), loadBookExcerpt(db, lesson)])
  return { course, brief, lesson, dossier, bookExcerpt, outcomes: outcomes.success ? outcomes.data : [] }
}

export type LessonAgentContext = Awaited<ReturnType<typeof loadLessonContext>>

/** The lesson's current written content, required by downstream lesson agents. */
export async function loadCurrentLessonContent(
  db: DbClient,
  lessonId: string
): Promise<{ versionId: string; content: LessonContent }> {
  const row = await lessonService.findCurrentVersion(db, lessonId)
  const version = row?.currentVersion
  if (!version) throw new AgentInputError('The lesson has not been written yet.')
  const parsed = lessonContentSchema.safeParse(version.content)
  if (!parsed.success) throw new AgentInputError('The lesson content is invalid.')
  return { versionId: version.id, content: parsed.data }
}

export function describeOutcomesForPrompt(outcomes: readonly LearningOutcome[], focusRefs: readonly string[]): string {
  if (outcomes.length === 0) return '(no learning outcomes defined)'
  return outcomes
    .map((o) => `${o.id}${focusRefs.includes(o.id) ? ' (this lesson)' : ''}: ${o.text}`)
    .join('\n')
}

export function describeLessonPlacement(context: LessonAgentContext): string {
  const { lesson } = context
  const siblings = lesson.module.lessons
  const index = siblings.findIndex((l) => l.id === lesson.id)
  const previous = index > 0 ? siblings[index - 1]?.title : null
  const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1]?.title : null
  return [
    `Module ${lesson.module.position + 1}: ${lesson.module.title}${lesson.module.summary ? ` — ${lesson.module.summary}` : ''}`,
    `This lesson: ${lesson.position + 1}. ${lesson.title} (${lesson.estimatedMinutes} minutes)`,
    previous ? `Previous lesson: ${previous}` : 'This is the first lesson of the module.',
    next ? `Next lesson: ${next}` : 'This is the last lesson of the module.',
  ].join('\n')
}

/** Compact rendering of written lesson content for downstream agents. */
export function describeLessonContentForPrompt(content: LessonContent): string {
  const lines: string[] = [`Objectives: ${content.objectives.join('; ')}`]
  for (const section of content.sections) {
    switch (section.type) {
      case 'code_demo':
        lines.push(`[code_demo${section.heading ? `: ${section.heading}` : ''}] (${section.language})\n${section.code}\n${section.explanation}`)
        break
      case 'common_mistakes':
        lines.push(`[common_mistakes]\n${section.items.map((i) => `- ${i.mistake} → ${i.fix}`).join('\n')}`)
        break
      case 'illustration_request':
        lines.push(`[illustration_request: ${section.kind}] ${section.prompt}`)
        break
      case 'further_learning':
        lines.push(`[further_learning] ${section.items.join('; ')}`)
        break
      default:
        lines.push(`[${section.type}${section.heading ? `: ${section.heading}` : ''}]\n${section.body}`)
    }
  }
  return lines.join('\n\n')
}

export const moduleAgentInputSchema = z.object({ courseId: z.string().min(1), moduleId: z.string().min(1) })
export type ModuleAgentInput = z.infer<typeof moduleAgentInputSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: describeLessonsForPrompt, lesson digest
 *
 * WHAT:  A compact digest of several written lessons (objectives, section
 *        headings, code languages, common mistakes) for course- and
 *        section-level agents.
 * WHY:   Section quizzes, the final assessment and the project must cover
 *        what was actually taught, but whole lessons would blow the context
 *        window; objectives + structure + mistakes carry what they need.
 */
export function describeLessonsForPrompt(
  lessons: ReadonlyArray<{ title: string; objectiveRefs: readonly string[]; module: { title: string }; currentVersion: { content: unknown } | null }>
): string {
  return lessons
    .map((lesson) => {
      const parsed = lessonContentSchema.safeParse(lesson.currentVersion?.content)
      if (!parsed.success) return `- ${lesson.module.title} › ${lesson.title} [${lesson.objectiveRefs.join(', ')}]`
      const content = parsed.data
      const headings = content.sections.flatMap((s) => ('heading' in s && s.heading ? [s.heading] : []))
      const mistakes = content.sections.flatMap((s) => (s.type === 'common_mistakes' ? s.items.map((i) => i.mistake) : []))
      const code = [...new Set(content.sections.flatMap((s) => (s.type === 'code_demo' ? [s.language] : [])))]
      return [
        `- ${lesson.module.title} › ${lesson.title} [${lesson.objectiveRefs.join(', ')}]`,
        `  Objectives: ${content.objectives.join('; ')}`,
        headings.length ? `  Covers: ${headings.join('; ')}` : '',
        code.length ? `  Code: ${code.join(', ')}` : '',
        mistakes.length ? `  Common mistakes: ${mistakes.join('; ')}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    })
    .join('\n')
}

/* Planning prompts carry at most this much page preview text in total. */
const OUTLINE_LEAD_BUDGET = 60_000

/**
 * SOURCE OF TRUTH KEYWORDS: loadBookOutline, BookOutline,
 *   describeBookOutlineForPrompt, course book outline, CH-n chapter refs
 *
 * WHAT:  The ticked chapters of the course book, each with a short ref
 *        (CH-1, CH-2, ...), its pages, and its topics; chapters without
 *        bookmarked topics get the opening words of each page instead.
 * WHY:   Planning agents need the book's whole shape but not its full text.
 *        Short refs are what the Curriculum Architect writes back, so the
 *        model never has to copy database ids. Null for courses without a
 *        book.
 * WHERE: research and curriculumArchitect.
 */
export async function loadBookOutline(db: DbClient, courseId: string) {
  const chapters = await courseBookService.listSelectedChapters(db, courseId)
  if (chapters.length === 0) return null
  const parsed = chapters.map((chapter) => ({ ...chapter, topics: bookTopicsSchema.safeParse(chapter.topics).data ?? [] }))
  const previewPages = parsed.filter((c) => c.topics.length === 0).reduce((sum, c) => sum + c.pages.length, 0)
  const leadChars = Math.max(60, Math.min(300, Math.floor(OUTLINE_LEAD_BUDGET / Math.max(1, previewPages))))
  return parsed.map((chapter, index) => ({
    ref: `CH-${index + 1}`,
    id: chapter.id,
    title: chapter.title,
    startPage: chapter.startPage,
    endPage: chapter.endPage,
    topics: chapter.topics,
    pageLeads:
      chapter.topics.length > 0
        ? []
        : chapter.pages.map((text, offset) => ({ page: chapter.startPage + offset, lead: text.slice(0, leadChars) })),
  }))
}

export type BookOutline = NonNullable<Awaited<ReturnType<typeof loadBookOutline>>>

export function describeBookOutlineForPrompt(outline: BookOutline): string {
  return outline
    .map((chapter) => {
      const detail =
        chapter.topics.length > 0
          ? chapter.topics.map((t) => `  - p.${t.page} ${t.title}`)
          : chapter.pageLeads.map((p) => `  - p.${p.page}: ${p.lead}`)
      return [`${chapter.ref}: ${chapter.title} (pages ${chapter.startPage}–${chapter.endPage})`, ...detail].join('\n')
    })
    .join('\n\n')
}

/**
 * SOURCE OF TRUTH KEYWORDS: loadBookExcerpt, BookExcerpt,
 *   describeBookExcerptForPrompt, lesson book pages, book grounding
 *
 * WHAT:  The text of the book pages one lesson teaches (its page range, or
 *        its whole chapter when no range was set), capped in size.
 * WHY:   Lesson, exercise and quiz agents must teach what the book says, in
 *        its terminology and formats (an ACCA answer layout, a standard's
 *        wording), but only for this lesson's slice of the book.
 * WHERE: loadLessonContext → lessonWriter, exerciseDesigner,
 *        assessmentDesigner.
 */
async function loadBookExcerpt(
  db: DbClient,
  lesson: { bookStartPage: number | null; bookEndPage: number | null; module: { bookChapterId: string | null } }
) {
  if (!lesson.module.bookChapterId) return null
  const chapter = await courseBookService.findChapterPages(db, lesson.module.bookChapterId)
  if (!chapter) return null
  const start = Math.min(Math.max(lesson.bookStartPage ?? chapter.startPage, chapter.startPage), chapter.endPage)
  const end = Math.max(Math.min(lesson.bookEndPage ?? chapter.endPage, chapter.endPage), start)
  const text = chapter.pages
    .slice(start - chapter.startPage, end - chapter.startPage + 1)
    .map((page, offset) => `[p.${start + offset}] ${page}`)
    .join('\n\n')
    .slice(0, COURSE_BOOK_LIMITS.excerptChars)
  return { chapterTitle: chapter.title, startPage: start, endPage: end, text }
}

export type BookExcerpt = NonNullable<Awaited<ReturnType<typeof loadBookExcerpt>>>

export function describeBookExcerptForPrompt(excerpt: BookExcerpt | null): string {
  if (!excerpt) return ''
  return [
    `Course book excerpt — ${excerpt.chapterTitle}, pages ${excerpt.startPage}–${excerpt.endPage} (authoritative):`,
    'Teach exactly this material, keep its terminology, rules, formats and worked-example style, and prefer it over your own knowledge. Explain in your own words; never copy more than a short phrase verbatim.',
    '"""',
    excerpt.text,
    '"""',
  ].join('\n')
}
