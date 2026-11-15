/**
 * SOURCE OF TRUTH KEYWORDS: courseBookFileSchema, uploadCourseBookSchema,
 *   selectBookChaptersSchema, bookTopicSchema, BookTopic, ExtractedBook,
 *   bookCourseFormSchema, bookChaptersFormSchema, courseBookUploadFormSchema,
 *   COURSE_BOOK_LIMITS,
 *   course book upload
 *
 * WHAT:  Contracts for the course book: the PDF upload (a File, validated the
 *        same way in the browser and on the server), the chapter selection,
 *        the stored chapter topics, and the shape the PDF reader returns.
 * WHY:   One schema per input keeps the new-course form, the workspace book
 *        card and the courseBooks router in step. The upload arrives as
 *        FormData (files are not JSON), so the server schema parses the
 *        FormData into the same typed object the client validated.
 * WHERE: courseBooks router, src/lib/books (PDF reader), new-course form,
 *        CourseBookCard. Re-exported via src/lib/types.
 */

import { z } from 'zod'

import { audienceProfileSchema } from './audience'
import { courseBriefSchema } from './course-content'

const BOOK_MAX_MEGABYTES = 100

export const COURSE_BOOK_LIMITS = {
  maxMegabytes: BOOK_MAX_MEGABYTES,
  maxBytes: BOOK_MAX_MEGABYTES * 1024 * 1024,
  mimeType: 'application/pdf',
  /* Characters of book text one lesson prompt may carry. */
  excerptChars: 40_000,
} as const

export const courseBookFileSchema = z
  .instanceof(File, { message: 'Choose a PDF file.' })
  .refine((file) => file.size > 0, 'The file is empty.')
  .refine((file) => file.size <= COURSE_BOOK_LIMITS.maxBytes, `The book must be ${BOOK_MAX_MEGABYTES} MB or smaller.`)
  .refine(
    (file) => file.type === COURSE_BOOK_LIMITS.mimeType || file.name.toLowerCase().endsWith('.pdf'),
    'The book must be a PDF.'
  )

/* The upload FormData: organizationId, courseId, `file` and `autopilot`. */
export const uploadCourseBookSchema = z
  .instanceof(FormData)
  .transform((data) => ({
    organizationId: data.get('organizationId'),
    courseId: data.get('courseId'),
    file: data.get('file'),
    autopilot: data.get('autopilot') ?? 'false',
  }))
  .pipe(
    z.object({
      organizationId: z.string().min(1),
      courseId: z.string().min(1),
      file: courseBookFileSchema,
      /* "true": book-first course, plan and build without stopping. */
      autopilot: z.enum(['true', 'false']).transform((value) => value === 'true'),
    })
  )

export const selectBookChaptersSchema = z.object({
  organizationId: z.string().min(1),
  courseId: z.string().min(1),
  chapterIds: z.array(z.string().min(1).max(64)).min(1, 'Pick at least one chapter.').max(300),
})

/* The workspace chapter picker form (org and course come from the page). */
export const bookChaptersFormSchema = selectBookChaptersSchema.pick({ chapterIds: true })

/* The workspace upload form (a new or replacement book). */
export const courseBookUploadFormSchema = z.object({ file: courseBookFileSchema })

/* Book-first new course: the PDF plus who it is for (learner level and
 * optional refinements); the Brief Writer fills in everything else. */
export const bookCourseFormSchema = z.object({
  organizationId: z.string().min(1),
  book: courseBookFileSchema,
  audienceProfile: audienceProfileSchema,
  teachingStyle: courseBriefSchema.shape.teachingStyle,
})

/** A sub-heading inside a chapter and the page it starts on. */
export const bookTopicSchema = z.object({
  title: z.string().max(300),
  page: z.number().int().min(1),
})
export const bookTopicsSchema = z.array(bookTopicSchema)

export type UploadCourseBookValues = z.infer<typeof uploadCourseBookSchema>
export type SelectBookChaptersValues = z.infer<typeof selectBookChaptersSchema>
export type BookCourseFormValues = z.infer<typeof bookCourseFormSchema>
export type BookChaptersFormValues = z.infer<typeof bookChaptersFormSchema>
export type CourseBookUploadFormValues = z.infer<typeof courseBookUploadFormSchema>
export type BookTopic = z.infer<typeof bookTopicSchema>

/** What the PDF reader returns; chapters map 1:1 to CourseBookChapter rows. */
export interface ExtractedBook {
  title: string
  pageCount: number
  chapters: Array<{
    title: string
    startPage: number
    endPage: number
    topics: BookTopic[]
    pages: string[]
    selected: boolean
  }>
}

/** readCourseBook: a text PDF read into chapters, or a scanned one to OCR. */
export type ReadBookResult =
  | { scanned: false; book: ExtractedBook }
  | { scanned: true; title: string; pageCount: number }

/**
 * SOURCE OF TRUTH KEYWORDS: bookBriefSchema, BookBrief, brief from book
 * WHAT:  The brief fields the Brief Writer fills in from a course book
 *        (book-first courses ask the author for nothing but the PDF).
 * WHERE: briefWriter agent output; merged into Course.brief.
 */
export const bookBriefSchema = courseBriefSchema.pick({
  topic: true,
  description: true,
  audience: true,
  difficulty: true,
  language: true,
  teachingStyle: true,
  targetDurationMinutes: true,
})
export type BookBrief = z.infer<typeof bookBriefSchema>
