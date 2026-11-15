import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: course-book.service, findCourseBook,
 *   replaceCourseBook, setSelectedChapters, deleteCourseBook,
 *   listSelectedChapters, findChapterPages, CourseBook rows, createReadingBook,
 *   saveScannedPage, finishScannedBook, scanned book pages
 *
 * WHAT:  Database access for a course's book and its chapters.
 * WHY:   The only layer that touches CourseBook / CourseBookChapter. Page
 *        text is heavy (a whole book), so the UI read never selects it; only
 *        agents read pages, and only for the chapters or lessons they need.
 * WHERE: courseBooks router, courses.generate (PLAN_COURSE check), and the
 *        course agents via src/lib/agents/course-context.ts.
 */

import type { DbClient } from '@/lib/config'
import type { ExtractedBook } from '@/lib/types'

/** The book and its chapter list for the workspace (no page text). */
export function findCourseBook(db: DbClient, courseId: string) {
  return db.courseBook.findUnique({
    where: { courseId },
    select: {
      id: true,
      title: true,
      fileName: true,
      pageCount: true,
      status: true,
      pagesRead: true,
      createdAt: true,
      asset: { select: { id: true, bytes: true } },
      chapters: {
        orderBy: { position: 'asc' },
        select: { id: true, position: true, title: true, startPage: true, endPage: true, topics: true, selected: true },
      },
    },
  })
}

/** Replaces any earlier book of the course (its chapters cascade away). */
export async function replaceCourseBook(
  db: DbClient,
  data: { organizationId: string; courseId: string; assetId: string; fileName: string; book: ExtractedBook }
) {
  await db.courseBook.deleteMany({ where: { courseId: data.courseId } })
  return db.courseBook.create({
    data: {
      organizationId: data.organizationId,
      courseId: data.courseId,
      assetId: data.assetId,
      title: data.book.title,
      fileName: data.fileName,
      pageCount: data.book.pageCount,
      chapters: {
        createMany: {
          data: data.book.chapters.map((chapter, position) => ({ position, ...chapter })),
        },
      },
    },
    select: { id: true },
  })
}

/** Ticks exactly `chapterIds`; returns how many of them belong to the book. */
export async function setSelectedChapters(db: DbClient, bookId: string, chapterIds: readonly string[]) {
  await db.courseBookChapter.updateMany({ where: { bookId }, data: { selected: false } })
  const result = await db.courseBookChapter.updateMany({
    where: { bookId, id: { in: [...chapterIds] } },
    data: { selected: true },
  })
  return result.count
}

export function countSelectedChapters(db: DbClient, courseId: string) {
  return db.courseBookChapter.count({ where: { book: { courseId }, selected: true } })
}

/** Removes the book's asset row; the book and chapters cascade with it. */
export function deleteCourseBook(db: DbClient, courseId: string) {
  return db.asset.deleteMany({ where: { courseId, bookFor: { isNot: null } } })
}

/** Selected chapters with their page text, in book order (planning agents). */
export function listSelectedChapters(db: DbClient, courseId: string) {
  return db.courseBookChapter.findMany({
    where: { book: { courseId }, selected: true },
    orderBy: { position: 'asc' },
    select: { id: true, position: true, title: true, startPage: true, endPage: true, topics: true, pages: true },
  })
}

/** One chapter's page text (lesson agents). */
export function findChapterPages(db: DbClient, chapterId: string) {
  return db.courseBookChapter.findUnique({
    where: { id: chapterId },
    select: { title: true, startPage: true, endPage: true, pages: true },
  })
}

// ── Scanned books ────────────────────────────────────────────────────────

/** A scanned book: no chapters yet, READING until its pages are read. */
export async function createReadingBook(
  db: DbClient,
  data: { organizationId: string; courseId: string; assetId: string; fileName: string; title: string; pageCount: number }
) {
  await db.courseBook.deleteMany({ where: { courseId: data.courseId } })
  return db.courseBook.create({ data: { ...data, status: 'READING', pagesRead: 0 }, select: { id: true } })
}

/** The course's book with its stored PDF key (agents). */
export function findBookForAgent(db: DbClient, courseId: string) {
  return db.courseBook.findUnique({
    where: { courseId },
    select: { id: true, title: true, pageCount: true, status: true, asset: { select: { storageKey: true } } },
  })
}

/** Saves one page's read text and refreshes the progress counter. */
export async function saveScannedPage(db: DbClient, bookId: string, page: number, text: string) {
  await db.courseBookPage.upsert({
    where: { bookId_page: { bookId, page } },
    create: { bookId, page, text },
    update: { text },
  })
  const pagesRead = await db.courseBookPage.count({ where: { bookId } })
  await db.courseBook.update({ where: { id: bookId }, data: { pagesRead } })
}

export function listScannedPages(db: DbClient, bookId: string) {
  return db.courseBookPage.findMany({ where: { bookId }, orderBy: { page: 'asc' }, select: { page: true, text: true } })
}

/** Stores the assembled chapters, marks the book READY, drops the page rows. */
export async function finishScannedBook(db: DbClient, bookId: string, chapters: ExtractedBook['chapters']) {
  await db.courseBookChapter.deleteMany({ where: { bookId } })
  await db.courseBookChapter.createMany({ data: chapters.map((chapter, position) => ({ bookId, position, ...chapter })) })
  await db.courseBookPage.deleteMany({ where: { bookId } })
  await db.courseBook.update({ where: { id: bookId }, data: { status: 'READY' } })
}
