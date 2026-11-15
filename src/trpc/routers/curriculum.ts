/**
 * SOURCE OF TRUTH KEYWORDS: curriculumRouter, curriculum editor,
 *   curriculum.updateModule, curriculum.createLesson, curriculum.move,
 *   curriculum.remove, assertCurriculumEditable
 *
 * WHAT:  Edits to a planned (not yet approved) curriculum: rename and
 *        re-describe modules, rename lessons and change durations, add,
 *        delete, and reorder modules and lessons (blueprint §29).
 * WHY:   A separate router keeps courses.ts about production control. Every
 *        procedure is gated by courses:update and audited under the
 *        `courses` entity. Editing is refused once the curriculum is approved
 *        (lessons are generated from it) or while a job is running (the
 *        Curriculum Architect may be replacing these rows). Module minutes
 *        are recomputed whenever lesson durations change.
 * WHERE: Mounted as `curriculum`; used by the curriculum editor.
 */

import { TRPCError } from '@trpc/server'

import { createTRPCRouter } from '../init'
import { protectedProcedure } from '../procedures'
import { LessonStatus } from '@/generated/prisma'
import type { DbClient } from '@/lib/config'
import { permissions } from '@/lib/permissions'
import {
  createLessonSchema,
  createModuleSchema,
  deleteCurriculumItemSchema,
  moveCurriculumItemSchema,
  updateLessonSchema,
  updateModuleSchema,
} from '@/lib/types'
import * as courseService from '@/services/course.service'
import * as generationService from '@/services/generation.service'

async function assertCurriculumEditable(db: DbClient, organizationId: string, courseId: string) {
  const course = await courseService.findCourse(db, organizationId, courseId)
  if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
  if (course.curriculumApprovedAt) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'The curriculum is approved and locked.' })
  }
  if (await generationService.hasLiveCourseJob(db, courseId)) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Wait for the running generation to finish before editing.' })
  }
  return course
}

function swap<T>(items: readonly T[], index: number, direction: 'up' | 'down'): T[] | null {
  const target = direction === 'up' ? index - 1 : index + 1
  if (index < 0 || target < 0 || target >= items.length) return null
  const next = [...items]
  const a = next[index]
  const b = next[target]
  if (a === undefined || b === undefined) return null
  next[index] = b
  next[target] = a
  return next
}

const edit = (action: string, describe: string) =>
  protectedProcedure({
    requirePermission: permissions.COURSES_UPDATE,
    audit: { entity: 'courses', action, describe },
  })

export const curriculumRouter = createTRPCRouter({
  updateModule: edit('updateModule', 'Edited module {input.title}')
    .input(updateModuleSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCurriculumEditable(ctx.db, input.organizationId, input.courseId)
      const mod = await courseService.findModuleInCourse(ctx.db, input.courseId, input.moduleId)
      if (!mod) throw new TRPCError({ code: 'NOT_FOUND', message: 'Module not found.' })
      return courseService.updateModule(ctx.db, mod.id, { title: input.title, summary: input.summary })
    }),

  createModule: edit('createModule', 'Added module {input.title}')
    .input(createModuleSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCurriculumEditable(ctx.db, input.organizationId, input.courseId)
      const order = await courseService.listModuleOrder(ctx.db, input.courseId)
      return courseService.createModule(ctx.db, {
        organizationId: input.organizationId,
        courseId: input.courseId,
        position: order.length,
        title: input.title,
        objectiveRefs: [],
      })
    }),

  updateLesson: edit('updateLesson', 'Edited lesson {input.title}')
    .input(updateLessonSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCurriculumEditable(ctx.db, input.organizationId, input.courseId)
      const lesson = await courseService.findLessonInCourse(ctx.db, input.courseId, input.lessonId)
      if (!lesson) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lesson not found.' })
      const updated = await courseService.updateLesson(ctx.db, lesson.id, {
        title: input.title,
        estimatedMinutes: input.estimatedMinutes,
      })
      await courseService.refreshModuleMinutes(ctx.db, lesson.moduleId)
      return updated
    }),

  createLesson: edit('createLesson', 'Added lesson {input.title}')
    .input(createLessonSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCurriculumEditable(ctx.db, input.organizationId, input.courseId)
      const mod = await courseService.findModuleInCourse(ctx.db, input.courseId, input.moduleId)
      if (!mod) throw new TRPCError({ code: 'NOT_FOUND', message: 'Module not found.' })
      const order = await courseService.listLessonOrder(ctx.db, mod.id)
      const created = await courseService.createLesson(ctx.db, {
        organizationId: input.organizationId,
        courseId: input.courseId,
        moduleId: mod.id,
        position: order.length,
        title: input.title,
        objectiveRefs: mod.objectiveRefs,
        estimatedMinutes: input.estimatedMinutes,
        status: LessonStatus.PLANNED,
      })
      await courseService.refreshModuleMinutes(ctx.db, mod.id)
      return created
    }),

  move: edit('move', 'Moved {input.itemType} {input.direction}')
    .input(moveCurriculumItemSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCurriculumEditable(ctx.db, input.organizationId, input.courseId)
      if (input.itemType === 'module') {
        const order = await courseService.listModuleOrder(ctx.db, input.courseId)
        const next = swap(order.map((m) => m.id), order.findIndex((m) => m.id === input.itemId), input.direction)
        if (next) await courseService.setModulePositions(ctx.db, next)
      } else {
        const lesson = await courseService.findLessonInCourse(ctx.db, input.courseId, input.itemId)
        if (!lesson) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lesson not found.' })
        const order = await courseService.listLessonOrder(ctx.db, lesson.moduleId)
        const next = swap(order.map((l) => l.id), order.findIndex((l) => l.id === lesson.id), input.direction)
        if (next) await courseService.setLessonPositions(ctx.db, next)
      }
      return { id: input.itemId }
    }),

  remove: edit('remove', 'Removed {input.itemType} {output.title}')
    .input(deleteCurriculumItemSchema)
    .mutation(async ({ ctx, input }) => {
      await assertCurriculumEditable(ctx.db, input.organizationId, input.courseId)
      if (input.itemType === 'module') {
        const mod = await courseService.findModuleInCourse(ctx.db, input.courseId, input.itemId)
        if (!mod) throw new TRPCError({ code: 'NOT_FOUND', message: 'Module not found.' })
        const removed = await courseService.deleteModule(ctx.db, mod.id)
        const order = await courseService.listModuleOrder(ctx.db, input.courseId)
        await courseService.setModulePositions(ctx.db, order.map((m) => m.id))
        return removed
      }
      const lesson = await courseService.findLessonInCourse(ctx.db, input.courseId, input.itemId)
      if (!lesson) throw new TRPCError({ code: 'NOT_FOUND', message: 'Lesson not found.' })
      const removed = await courseService.deleteLesson(ctx.db, lesson.id)
      const order = await courseService.listLessonOrder(ctx.db, lesson.moduleId)
      await courseService.setLessonPositions(ctx.db, order.map((l) => l.id))
      await courseService.refreshModuleMinutes(ctx.db, lesson.moduleId)
      return removed
    }),
})
