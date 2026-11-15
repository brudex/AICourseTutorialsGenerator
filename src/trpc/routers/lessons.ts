/**
 * SOURCE OF TRUTH KEYWORDS: lessonsRouter, lessons.get, lesson package,
 *   lesson page data
 *
 * WHAT:  Reads one lesson's full package for the lesson page: notes (current
 *        version), video scene script, exercises, quiz, and the latest QA
 *        review.
 * WHY:   Every Json column is re-validated against its Zod schema on the way
 *        out, so the UI renders typed data and a malformed row degrades to
 *        "unavailable" instead of crashing the page. Editing lands in a later
 *        step; this is read-only.
 *        The package itself comes from loadLessonView, the shared lesson read model.
 * WHERE: Mounted as `lessons`; used by /dashboard/courses/[courseId]/lessons/[lessonId].
 */

import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { createTRPCRouter } from '../init'
import { protectedProcedure } from '../procedures'
import { permissions } from '@/lib/permissions'
import { lessonIdSchema, qaIssueSchema } from '@/lib/types'
import { loadLessonView } from '@/lib/courses/lesson-view'
import * as courseService from '@/services/course.service'
import * as lessonService from '@/services/lesson.service'

const qaOutputSchema = z.object({
  verdict: z.enum(['pass', 'revise']),
  reviewedVersionId: z.string(),
  issues: z.array(qaIssueSchema),
})

export const lessonsRouter = createTRPCRouter({
  get: protectedProcedure({ requirePermission: permissions.COURSES_READ })
    .input(lessonIdSchema)
    .query(async ({ ctx, input }) => {
      const course = await courseService.findCourse(ctx.db, input.organizationId, input.courseId)
      if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
      const [view, qaTask] = await Promise.all([
        loadLessonView(ctx.db, course.id, input.lessonId),
        lessonService.findLatestLessonQaTask(ctx.db, course.id, input.lessonId),
      ])
      if (!view) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lesson not found.' })
      const qa = qaTask ? qaOutputSchema.safeParse(qaTask.output) : null
      return {
        course: { id: course.id, title: course.title },
        ...view,
        qa: qa?.success ? { ...qa.data, reviewedAt: qaTask?.finishedAt ?? null } : null,
      }
    }),
})
