import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: researchAgent, Research Agent, ResearchDossier,
 *   researchDossierContentSchema, source material grounding
 *
 * WHAT:  Researches the course topic before any curriculum or lesson exists
 *        (blueprint §8) and stores a versioned ResearchDossier.
 * WHY:   Separating research from writing gives every later agent the same
 *        vetted facts, sequence, and mistake list instead of each re-deriving
 *        them. MVP 1 grounding (decision D3): the author's pasted source
 *        material takes priority over model knowledge, and anything uncertain
 *        or version-sensitive must be recorded as a caveat — which the UI
 *        surfaces — rather than stated as fact.
 *        A course book narrows the scope to its ticked chapters (outline only;
 *        lessons later read the pages themselves).
 * WHERE: Registered as `research` in src/lib/agents/registry.ts; first task
 *        of every PLAN_COURSE job.
 */

import { AiCapability } from '@/generated/prisma'
import { researchDossierContentSchema } from '@/lib/types'
import * as courseService from '@/services/course.service'
import { defineAgent } from './define-agent'
import {
  courseAgentInputSchema,
  describeBookOutlineForPrompt,
  describeBriefForPrompt,
  loadBookOutline,
  loadCourseForAgent,
} from './course-context'

export const researchAgent = defineAgent({
  name: 'Research Agent',
  description: 'Researches the topic: concepts, prerequisites, sequence, common mistakes, caveats',
  capability: AiCapability.STRONG_REASONING,
  inputSchema: courseAgentInputSchema,
  outputSchema: researchDossierContentSchema,
  schemaName: 'research_dossier',
  temperature: 0.3,
  /* Room for reasoning models, which spend output tokens thinking; also sets a 5 minute timeout. */
  maxOutputTokens: 12_000,

  loadContext: async (db, input, job) => ({
    ...(await loadCourseForAgent(db, job.organizationId, input.courseId)),
    book: await loadBookOutline(db, input.courseId),
  }),

  buildMessages: ({ brief, book }) => [
    {
      role: 'system',
      content: [
        'You are a senior subject-matter researcher working with an instructional design team.',
        'Your job is to produce an accurate research dossier that course writers will rely on.',
        'Rules:',
        '- Accuracy over coverage. Never invent APIs, statistics, dates, citations, or version numbers.',
        '- If source material is provided, treat it as authoritative and prefer it over your own knowledge; note any conflicts as caveats.',
        '- Anything you are unsure of, or that changes over time (versions, prices, laws, current best practice), goes in `caveats` — do not present it as settled fact.',
        '- Pitch the depth to the stated audience and learner level.',
        '- `recommendedSequence` is an ordered list of concepts, simplest and most foundational first.',
        '- `commonMistakes` are the specific misconceptions this audience actually has, not generic advice.',
        '- If a course book outline is provided, the course covers exactly those chapters: research their concepts, in book order, and use the book\'s terminology.',
        '- Write all text in the requested language.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Research this course topic.',
        '',
        describeBriefForPrompt(brief),
        '',
        brief.sourceMaterial
          ? `Source material provided by the course author (authoritative):\n"""\n${brief.sourceMaterial}\n"""`
          : 'No source material was provided — rely on well-established knowledge and flag uncertainty.',
        book ? `\nCourse book outline (authoritative scope, the chapters this course covers):\n${describeBookOutlineForPrompt(book)}` : '',
      ].join('\n'),
    },
  ],

  persist: async (db, { output, execution }) => {
    const latest = await courseService.findLatestDossier(db, execution.job.courseId)
    const dossier = await courseService.createDossier(db, {
      organizationId: execution.job.organizationId,
      courseId: execution.job.courseId,
      version: (latest?.version ?? 0) + 1,
      content: output,
      createdByTaskId: execution.task.id,
    })
    return {
      dossierId: dossier.id,
      version: dossier.version,
      keyConcepts: output.keyConcepts.length,
      caveats: output.caveats.length,
    }
  },
})
