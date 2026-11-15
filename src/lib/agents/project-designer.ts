import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: projectDesignerAgent, Project Designer, final
 *   project, capstone brief, projectBriefSchema
 *
 * WHAT:  Designs the course's final capstone project: brief, milestones,
 *        starter files, a points rubric, stretch goals, and a reference
 *        solution, stored on Course.finalProject.
 * WHY:   A hands-on project is how learners prove the outcomes together
 *        (docs/11 §1). Written after every lesson so it uses exactly the
 *        concepts and code style the course taught.
 * WHERE: Registered as `projectDesigner`; one task per BUILD_COURSE when the
 *        brief includes projects.
 */

import { AiCapability } from '@/generated/prisma'
import { learningOutcomeSchema, projectBriefSchema } from '@/lib/types'
import * as courseService from '@/services/course.service'
import * as lessonService from '@/services/lesson.service'
import { AgentInputError } from '@/lib/generation/errors'
import { defineAgent } from './define-agent'
import {
  courseAgentInputSchema,
  describeBriefForPrompt,
  describeLessonsForPrompt,
  describeOutcomesForPrompt,
  loadCourseForAgent,
  loadLatestDossier,
} from './course-context'

export const projectDesignerAgent = defineAgent({
  name: 'Project Designer',
  description: 'Designs the final project with milestones, starter files and a rubric',
  capability: AiCapability.CODING,
  inputSchema: courseAgentInputSchema,
  outputSchema: projectBriefSchema,
  schemaName: 'project_brief',
  temperature: 0.5,
  maxOutputTokens: 12_000,

  loadContext: async (db, input, job) => {
    const { course, brief } = await loadCourseForAgent(db, job.organizationId, input.courseId)
    const outcomes = learningOutcomeSchema.array().safeParse(course.outcomes)
    if (!outcomes.success || outcomes.data.length === 0) throw new AgentInputError('The course has no learning outcomes.')
    const [lessons, dossier] = await Promise.all([
      lessonService.listLessonContents(db, input.courseId),
      loadLatestDossier(db, input.courseId),
    ])
    return { brief, outcomes: outcomes.data, lessons, dossier }
  },

  buildMessages: ({ brief, outcomes, lessons, dossier }) => [
    {
      role: 'system',
      content: [
        'You design the final capstone project of a professional online course.',
        'Rules:',
        '- One realistic, motivating project that uses most learning outcomes; list them in `objectiveRefs`.',
        '- 3–6 milestones that build on each other; each has concrete tasks and a checkable deliverable.',
        '- For programming topics: `starterFiles` give a runnable skeleton with TODO comments (not the solution); `referenceSolution` is complete and correct, using only what the course taught. For non-programming topics leave both arrays empty and put templates in the milestone tasks.',
        '- `rubric`: 4–6 criteria with points (total about 100) tied to the milestones and outcomes.',
        '- `estimatedHours` is honest for the stated learner level; 1–3 `stretchGoals` for fast learners.',
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
        describeOutcomesForPrompt(outcomes, outcomes.map((o) => o.id)),
        '',
        'What the course taught:',
        describeLessonsForPrompt(lessons),
        '',
        dossier ? `Project ideas from research:\n${dossier.projectIdeas.map((p) => `- ${p}`).join('\n')}` : '',
      ].join('\n'),
    },
  ],

  persist: async (db, { output, context, execution }) => {
    const valid = new Set(context.outcomes.map((o) => o.id))
    const project = { ...output, objectiveRefs: output.objectiveRefs.filter((r) => valid.has(r)) }
    await courseService.updateCourse(db, execution.job.organizationId, execution.job.courseId, { finalProject: project })
    return {
      title: project.title,
      milestones: project.milestones.length,
      rubricPoints: project.rubric.reduce((sum, r) => sum + r.points, 0),
    }
  },
})
