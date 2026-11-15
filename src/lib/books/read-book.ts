import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: readCourseBook, CourseBookError, PDF reader,
 *   book chapters, PDF outline, bookmarks, unpdf, page text extraction
 *
 * WHAT:  Reads a course book PDF into chapters: the text of every page, each
 *        chapter's page range and its topics (sub-headings with pages).
 * WHY:   Study texts (ACCA and similar) are 300 to 600 pages, far more than
 *        any prompt can hold, so the book is split once at upload and agents
 *        later read only the pages a lesson teaches. Chapters come from the
 *        PDF's bookmarks when it has them (exact titles and pages), else from
 *        "Chapter N" headings at the top of pages, else from fixed page
 *        windows, so every text PDF yields usable chapters. Front matter,
 *        indexes, answer banks and similar are pre-unticked because they are
 *        not teaching chapters; the author can still tick them.
 *        Scanned PDFs are not rejected: readCourseBook flags them, a vision
 *        model reads each rendered page, and assembleScannedBook builds the
 *        chapters from that text.
 * WHERE: courseBooks.upload; bookPageReader and bookAssembler agents.
 */

import { extractText, getDocumentProxy, getMeta, renderPageAsImage } from 'unpdf'

import type { BookTopic, ExtractedBook, ReadBookResult } from '@/lib/types'

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>
type OutlineItem = Awaited<ReturnType<PdfDocument['getOutline']>>[number]

/** A problem with the file itself; the message is safe to show the author. */
export class CourseBookError extends Error {}

const PAGE_TEXT_MAX = 12_000
const WINDOW_PAGES = 20
const MIN_TEXT_CHARS = 500
const HEADING_PATTERN = /^(chapter|unit|part|module|lesson|section)\s+([0-9]{1,3}|[ivxlc]{1,6}|one|two|three|four|five|six|seven|eight|nine|ten)\b/i
/* "Chapter 12: Index" is still an index. */
const CHAPTER_PREFIX = /^(chapter|part|unit|section)\s+\S+?[:.\s–-]+/i
const NON_TEACHING_PATTERN =
  /^(front matter|contents|table of contents|index|preface|foreword|acknowledg|about (this|the) (book|author)|copyright|bibliography|references|glossary|answers?\b|solutions?\b|question bank|practice (questions|answers)|appendix|mathematical tables|formulae)/i

/* Spaces collapse but line breaks stay: headings are found by their line. */
function cleanText(text: string): string {
  return text
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n[\s]*/g, '\n')
    .trim()
    .slice(0, PAGE_TEXT_MAX)
}

/* Titles drop markdown marks a vision transcription may add (**, #, |). */
function cleanTitle(title: string): string {
  return title.replace(/[*#|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
}

/* 1-based page of an outline destination, or null when it can't be resolved. */
async function destinationPage(pdf: PdfDocument, dest: OutlineItem['dest']): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest
    const target = explicit?.[0]
    if (typeof target === 'number') return target + 1
    if (target && typeof target === 'object' && 'num' in target) return (await pdf.getPageIndex(target)) + 1
    return null
  } catch {
    return null
  }
}

/* Topics: every bookmark below a chapter (two levels deep), with its page. */
async function outlineTopics(pdf: PdfDocument, items: readonly OutlineItem[], depth = 0): Promise<BookTopic[]> {
  const topics: BookTopic[] = []
  for (const item of items) {
    const page = await destinationPage(pdf, item.dest)
    const title = cleanTitle(item.title)
    if (page && title) topics.push({ title, page })
    if (depth < 1 && item.items.length > 0) topics.push(...(await outlineTopics(pdf, item.items, depth + 1)))
  }
  return topics
}

interface ChapterStart {
  title: string
  page: number
  topics: BookTopic[]
}

/* Chapters from bookmarks; skips a single wrapping "book title" bookmark. */
async function chaptersFromOutline(pdf: PdfDocument): Promise<ChapterStart[]> {
  let level = (await pdf.getOutline()) ?? []
  while (level.length === 1 && (level[0]?.items.length ?? 0) > 0) level = level[0]?.items ?? []

  const starts: ChapterStart[] = []
  for (const item of level) {
    const page = await destinationPage(pdf, item.dest)
    const title = cleanTitle(item.title)
    if (!page || !title) continue
    starts.push({ title, page, topics: await outlineTopics(pdf, item.items) })
  }
  return starts.sort((a, b) => a.page - b.page).filter((s, i, all) => i === 0 || s.page !== all[i - 1]?.page)
}

/* Chapters from "Chapter 3 ..." style headings at the top of a page. */
function chaptersFromHeadings(pages: readonly string[]): ChapterStart[] {
  return pages.flatMap((text, index) => {
    /* The heading is the first non-empty line, minus markdown marks. */
    const firstLine = cleanTitle(text.split('\n').find((line) => cleanTitle(line).length > 0) ?? '')
    return HEADING_PATTERN.test(firstLine) ? [{ title: firstLine.slice(0, 100), page: index + 1, topics: [] }] : []
  })
}

function pageWindows(pageCount: number): ChapterStart[] {
  return Array.from({ length: Math.ceil(pageCount / WINDOW_PAGES) }, (_, i) => {
    const start = i * WINDOW_PAGES + 1
    return { title: `Pages ${start}–${Math.min(pageCount, start + WINDOW_PAGES - 1)}`, page: start, topics: [] }
  })
}

async function openPdf(bytes: Uint8Array): Promise<PdfDocument> {
  try {
    return await getDocumentProxy(bytes)
  } catch {
    throw new CourseBookError('This file could not be opened as a PDF. It may be damaged or password protected.')
  }
}

/* Chapters from bookmarks, else headings in the page text, else page windows. */
async function buildChapters(pdf: PdfDocument, pages: readonly string[], totalPages: number): Promise<ExtractedBook['chapters']> {
  const fromOutline = await chaptersFromOutline(pdf)
  const fromHeadings = fromOutline.length >= 2 ? [] : chaptersFromHeadings(pages)
  let starts = fromOutline.length >= 2 ? fromOutline : fromHeadings.length >= 2 ? fromHeadings : pageWindows(totalPages)
  const firstPage = starts[0]?.page ?? 1
  if (firstPage > 1) starts = [{ title: 'Front matter', page: 1, topics: [] }, ...starts]

  return starts.map((start, i) => {
    const endPage = Math.max(start.page, (starts[i + 1]?.page ?? totalPages + 1) - 1)
    return {
      title: start.title,
      startPage: start.page,
      endPage,
      topics: start.topics.filter((t) => t.page >= start.page && t.page <= endPage),
      pages: pages.slice(start.page - 1, endPage),
      selected: !NON_TEACHING_PATTERN.test(start.title.replace(CHAPTER_PREFIX, '')),
    }
  })
}

async function bookTitle(pdf: PdfDocument, fileName: string): Promise<string> {
  const meta = await getMeta(pdf).catch(() => null)
  const rawTitle: string | null = typeof meta?.info['Title'] === 'string' ? meta.info['Title'] : null
  /* Browsers and converters often stamp a placeholder or a URL as the title. */
  const metaTitle = rawTitle && !/^(about:blank|untitled|microsoft word|https?:)/i.test(rawTitle.trim()) ? rawTitle : null
  return cleanTitle(metaTitle || fileName.replace(/\.pdf$/i, '')) || 'Course book'
}

/**
 * SOURCE OF TRUTH KEYWORDS: readCourseBook, ReadBookResult, scanned detection
 *
 * WHAT:  A text PDF comes back read into chapters. A scanned PDF (no text
 *        layer) comes back as `scanned` with its title and page count; its
 *        pages are then read by a vision model (READ_BOOK job) and assembled
 *        with assembleScannedBook.
 */
export async function readCourseBook(bytes: Uint8Array, fileName: string): Promise<ReadBookResult> {
  const pdf = await openPdf(bytes)
  try {
    const { totalPages, text } = await extractText(pdf, { mergePages: false })
    const pages = text.map(cleanText)
    const title = await bookTitle(pdf, fileName)
    if (pages.reduce((sum, page) => sum + page.length, 0) < MIN_TEXT_CHARS) {
      return { scanned: true, title, pageCount: totalPages }
    }
    return { scanned: false, book: { title, pageCount: totalPages, chapters: await buildChapters(pdf, pages, totalPages) } }
  } finally {
    await pdf.loadingTask.destroy()
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: assembleScannedBook, scanned book chapters
 *
 * WHAT:  Chapters for a scanned book from the page text a vision model read
 *        (index 0 = page 1). Bookmarks still come from the PDF itself.
 */
export async function assembleScannedBook(bytes: Uint8Array, pageTexts: readonly string[]): Promise<ExtractedBook['chapters']> {
  const pdf = await openPdf(bytes)
  try {
    return await buildChapters(pdf, pageTexts.map(cleanText), pdf.numPages)
  } finally {
    await pdf.loadingTask.destroy()
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: renderBookPages, page images, scanned page render
 *
 * WHAT:  Renders pages of a PDF to PNG data URLs (BOOK_PAGE_WIDTH wide), for a
 *        vision model to read.
 * WHY:   @napi-rs/canvas is the prebuilt canvas pdf.js draws on in Node; the
 *        width keeps small print legible without sending huge images.
 */
const BOOK_PAGE_WIDTH = 1400

export async function renderBookPages(bytes: Uint8Array, pageNumbers: readonly number[]): Promise<Array<{ page: number; dataUrl: string }>> {
  const pdf = await openPdf(bytes)
  try {
    const rendered: Array<{ page: number; dataUrl: string }> = []
    for (const page of pageNumbers) {
      const png = await renderPageAsImage(pdf, page, { canvasImport: () => import('@napi-rs/canvas'), width: BOOK_PAGE_WIDTH })
      rendered.push({ page, dataUrl: `data:image/png;base64,${Buffer.from(png).toString('base64')}` })
    }
    return rendered
  } finally {
    await pdf.loadingTask.destroy()
  }
}
