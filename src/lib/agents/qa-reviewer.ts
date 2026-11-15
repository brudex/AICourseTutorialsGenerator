import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: qaReviewerAgent, QA Reviewer, qaReportSchema,
 *   lesson review, auto-approval, QA_FLAGGED
 *
 * WHAT:  Reviews one complete lesson package — notes, video scene script,
 *        exercises, and quiz — for accuracy, correctness, alignment, and
 *        teaching quality (blueprint §20), and decides the lesson's status.
 * WHY:   The QA verdict is the automatic approval gate (spec D6):
 *          • pass (or only low-severity issues) → APPROVED and the current
 *            version becomes the approved one, unless the course uses guided
 *            approval, in which case it waits as GENERATED;
 *          • medium/high issues → QA_FLAGGED with the issues shown on the
 *            lesson page.
 *        The full report is stored as the task output (it is small and
 *        versioned with the job that produced it).
 * WHERE: Registered as `qaReviewer`; last task per lesson in BUILD_COURSE.
 */

import { AiCapability, LessonStatus } from '@/generated/prisma'
import { qaReportSchema } from '@/lib/types'
import * as lessonService from '@/services/lesson.service'
import { defineAgent } from './define-agent'
import {
  describeBriefForPrompt,
  describeLessonContentForPrompt,
  describeOutcomesForPrompt,
  lessonAgentInputSchema,
  loadCurrentLessonContent,
  loadLessonContext,
} from './course-context'

export const qaReviewerAgent = defineAgent({
  name: 'QA Reviewer',
  description: 'Reviews notes, video script, exercises, and quiz for accuracy and quality',
  capability: AiCapability.STRONG_REASONING,
  inputSchema: lessonAgentInputSchema,
  outputSchema: qaReportSchema,
  schemaName: 'qa_report',
  temperature: 0.1,
  maxOutputTokens: 4_000,
  lessonIdOf: (input) => input.lessonId,

  loadContext: async (db, input, job) => {
    const context = await loadLessonContext(db, job.organizationId, input)
    const written = await loadCurrentLessonContent(db, input.lessonId)
    const [scenes, exercises, quiz] = await Promise.all([
      lessonService.listVersionScenes(db, written.versionId),
      lessonService.listActiveExercises(db, input.lessonId),
      lessonService.listActiveAssessments(db, input.lessonId),
    ])
    return { ...context, written, scenes, exercises, quiz }
  },

  buildMessages: (context) => [
    {
      role: 'system',
      content: [
        'You are the quality reviewer for a professional online course. Review one lesson package strictly.',
        'Check:',
        '- factual_accuracy: no false claims, invented APIs, or outdated practice presented as current.',
        '- code_correctness: every code sample, walkthrough, typed demo, and exercise solution would run and do what is claimed; highlight line ranges point at the right code.',
        '- curriculum_alignment: the lesson teaches its objectives and the outcomes marked "(this lesson)"; quiz questions test this lesson.',
        '- quiz_correctness: each answer key is right and each explanation is accurate.',
        '- clarity / difficulty: pitched at the stated audience and level; video narration matches what is on screen and sounds natural spoken aloud.',
        '- repetition, grammar, copyright (no long verbatim passages from known sources).',
        'Verdict: "pass" if a learner could use this lesson as-is; "revise" only for issues that would mislead, confuse, or break something.',
        'Each issue: severity (high = wrong or broken; medium = confusing or misaligned; low = polish), category, a precise location (e.g. "scene 4", "exercise 2 solution", "quiz q3"), the problem, and a concrete suggested fix.',
        'Do not report style preferences. Return an empty issues list if there are none.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Course brief:',
        describeBriefForPrompt(context.brief),
        '',
        'Learning outcomes:',
        describeOutcomesForPrompt(context.outcomes, context.lesson.objectiveRefs),
        '',
        `LESSON NOTES — ${context.lesson.title}`,
        describeLessonContentForPrompt(context.written.content),
        '',
        'VIDEO SCENES',
        context.scenes
          .map((s) => `scene ${s.position + 1} [${s.type}]\nnarration: ${s.narration}\non screen: ${JSON.stringify(s.onScreen)}`)
          .join('\n\n') || '(none)',
        '',
        'EXERCISES',
        context.exercises.map((e, i) => `exercise ${i + 1} [${e.level}] ${e.title}\n${JSON.stringify(e.content)}`).join('\n\n') ||
          '(none)',
        '',
        'QUIZ',
        context.quiz.map((q, i) => `q${i + 1} [${q.type}, ${q.objectiveRef}] ${JSON.stringify(q.content)}`).join('\n') || '(none)',
      ].join('\n'),
    },
  ],

  persist: async (db, { input, output, context }) => {
    const blocking = output.issues.some((i) => i.severity !== 'low')
    const flagged = output.verdict === 'revise' && blocking
    if (flagged) {
      await lessonService.setLessonStatus(db, input.lessonId, LessonStatus.QA_FLAGGED)
    } else if (context.course.guidedApproval) {
      await lessonService.setLessonStatus(db, input.lessonId, LessonStatus.GENERATED)
    } else {
      await lessonService.setLessonStatus(db, input.lessonId, LessonStatus.APPROVED, context.written.versionId)
    }
    return { verdict: flagged ? 'revise' : 'pass', reviewedVersionId: context.written.versionId, issues: output.issues }
  },
})
