/**
 * SOURCE OF TRUTH KEYWORDS: courseBooksRouter, courseBooks.get,
 *   courseBooks.upload, courseBooks.selectChapters, courseBooks.remove,
 *   course book, book-based course, ACCA study text
 *
 * WHAT:  The course book a course is built from: upload a PDF (read into
 *        chapters with page text), pick which chapters the course covers,
 *        or remove it.
 * WHY:   protectedProcedure handles auth, courses:* permissions and audit.
 *        The router owns the rule that the book can only change while the
 *        curriculum is still being planned (before approval, no live job),
 *        because modules and lessons point at its chapters and pages. The
 *        upload reads the PDF inside the request (a 600 page book takes
 *        seconds), so it gets a longer transaction timeout.
 * WHERE: Mounted as `courseBooks`; used by the new-course form and the
 *        CourseBookCard in the course workspace.
 */

import { TRPCError } from '@trpc/server'

import { AssetKind } from '@/generated/prisma'
import { createTRPCRouter } from '../init'
import { protectedProcedure } from '../procedures'
import { permissions } from '@/lib/permissions'
import type { DbClient } from '@/lib/config'
import {
  COURSE_BOOK_LIMITS,
  bookTopicsSchema,
  courseIdSchema,
  selectBookChaptersSchema,
  uploadCourseBookSchema,
  type ReadBookResult,
} from '@/lib/types'
import { CourseBookError, readCourseBook } from '@/lib/books'
import { bookAssetKey, courseStoragePrefix, getStorage } from '@/lib/storage'
import * as assetService from '@/services/asset.service'
import * as courseService from '@/services/course.service'
import * as courseBookService from '@/services/course-book.service'
import * as generationService from '@/services/generation.service'
import { enqueuePlanCourse, enqueueReadBook } from '@/lib/courses/plan-course'

const UPLOAD_TX_TIMEOUT_MS = 180_000

/* The course, provided its book may still change. */
async function findEditableCourse(db: DbClient, organizationId: string, courseId: string) {
  const course = await courseService.findCourse(db, organizationId, courseId)
  if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
  if (course.curriculumApprovedAt) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'The curriculum is approved, so the course book can no longer change.' })
  }
  if (await generationService.hasLiveCourseJob(db, course.id)) {
    throw new TRPCError({ code: 'CONFLICT', message: 'Wait for the running job to finish before changing the course book.' })
  }
  return course
}

export const courseBooksRouter = createTRPCRouter({
  /* The book and its chapters, or null when the course has none. */
  get: protectedProcedure({ requirePermission: permissions.COURSES_READ })
    .input(courseIdSchema)
    .query(async ({ ctx, input }) => {
      const course = await courseService.findCourse(ctx.db, input.organizationId, input.courseId)
      if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
      const book = await courseBookService.findCourseBook(ctx.db, course.id)
      if (!book) return null
      return {
        ...book,
        editable: course.curriculumApprovedAt === null,
        chapters: book.chapters.map((chapter) => ({
          ...chapter,
          topics: bookTopicsSchema.safeParse(chapter.topics).data ?? [],
        })),
      }
    }),

  upload: protectedProcedure({
    requirePermission: permissions.COURSES_UPDATE,
    audit: { action: 'upload_book', describe: 'Uploaded a course book' },
    txTimeout: UPLOAD_TX_TIMEOUT_MS,
  })
    .input(uploadCourseBookSchema)
    .mutation(async ({ ctx, input }) => {
      const course = await findEditableCourse(ctx.db, input.organizationId, input.courseId)
      const bytes = new Uint8Array(await input.file.arrayBuffer())

      let read: ReadBookResult
      try {
        /* pdf.js may detach the buffer it reads, so it gets its own copy. */
        read = await readCourseBook(bytes.slice(), input.file.name)
      } catch (error) {
        if (error instanceof CourseBookError) throw new TRPCError({ code: 'BAD_REQUEST', message: error.message })
        throw error
      }

      const key = bookAssetKey({ organizationId: input.organizationId, courseId: course.id })
      await getStorage().put({ key, body: bytes, contentType: COURSE_BOOK_LIMITS.mimeType })
      const asset = await assetService.upsertAsset(ctx.db, {
        organizationId: input.organizationId,
        courseId: course.id,
        kind: AssetKind.DOCUMENT,
        storageKey: key,
        mimeType: COURSE_BOOK_LIMITS.mimeType,
        bytes: bytes.byteLength,
      })
      const fileName = input.file.name.slice(0, 200)
      const owner = { organizationId: input.organizationId, courseId: course.id, createdById: ctx.user.id }
      if (input.autopilot) await courseService.updateCourse(ctx.db, input.organizationId, course.id, { autopilot: true })

      /* SCANNED_BOOK: no text layer, so a vision model reads every page in a
       * background job; autopilot courses plan when it finishes (hooks). */
      if (read.scanned) {
        await courseBookService.createReadingBook(ctx.db, {
          organizationId: input.organizationId,
          courseId: course.id,
          assetId: asset.id,
          fileName,
          title: read.title,
          pageCount: read.pageCount,
        })
        await enqueueReadBook(ctx.db, { ...owner, pageCount: read.pageCount })
        return { courseId: course.id, scanned: true, pageCount: read.pageCount, chapters: 0, selected: 0, planning: false }
      }

      const { book } = read
      await courseBookService.replaceCourseBook(ctx.db, { organizationId: input.organizationId, courseId: course.id, assetId: asset.id, fileName, book })
      /* AUTOPILOT: the Brief Writer fills the brief, then research and the
       * curriculum run, then the build starts on its own (hooks). */
      if (input.autopilot) await enqueuePlanCourse(ctx.db, { ...owner, writeBrief: true })
      return {
        courseId: course.id,
        scanned: false,
        pageCount: book.pageCount,
        chapters: book.chapters.length,
        selected: book.chapters.filter((c) => c.selected).length,
        planning: input.autopilot,
      }
    }),

  selectChapters: protectedProcedure({ requirePermission: permissions.COURSES_UPDATE })
    .input(selectBookChaptersSchema)
    .mutation(async ({ ctx, input }) => {
      const course = await findEditableCourse(ctx.db, input.organizationId, input.courseId)
      const book = await courseBookService.findCourseBook(ctx.db, course.id)
      if (!book) throw new TRPCError({ code: 'NOT_FOUND', message: 'This course has no course book.' })
      if (book.status === 'READING') throw new TRPCError({ code: 'CONFLICT', message: 'The book is still being read.' })
      const selected = await courseBookService.setSelectedChapters(ctx.db, book.id, input.chapterIds)
      if (selected === 0) throw new TRPCError({ code: 'BAD_REQUEST', message: 'Pick at least one chapter of this book.' })
      return { courseId: course.id, selected }
    }),

  remove: protectedProcedure({
    requirePermission: permissions.COURSES_UPDATE,
    audit: { action: 'remove_book', describe: 'Removed the course book' },
  })
    .input(courseIdSchema)
    .mutation(async ({ ctx, input }) => {
      const course = await findEditableCourse(ctx.db, input.organizationId, input.courseId)
      await courseBookService.deleteCourseBook(ctx.db, course.id)
      await getStorage().deletePrefix(`${courseStoragePrefix(input.organizationId, course.id)}book/`)
      return { courseId: course.id }
    }),
})
