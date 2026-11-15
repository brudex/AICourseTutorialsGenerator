import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: bookPageReaderAgent, bookAssemblerAgent,
 *   bookPagesInputSchema, scanned book OCR, READ_BOOK job, page transcription
 *
 * WHAT:  The two READ_BOOK agents for scanned course books.
 *        bookPageReader renders a range of pages to images and has the model
 *        routed for VISION transcribe each one, saving the text per page.
 *        bookAssembler runs after every range: it turns the page text into
 *        chapters (bookmarks first, then headings, then page windows) and
 *        marks the book READY.
 * WHY:   A 500 page scan cannot be read in one request, so pages are split
 *        into small ranges that run in parallel and retry on their own; a
 *        failed range only re-reads its own pages. Page text is saved as it
 *        arrives, so progress shows on the Book card. The transcription keeps
 *        headings on their own lines because chapter detection relies on them.
 * WHERE: Registered as `bookPageReader` and `bookAssembler`; queued by
 *        enqueueReadBook (src/lib/courses/plan-course.ts).
 */

import { z } from 'zod'

import { AiCapability } from '@/generated/prisma'
import type { AgentDefinition } from '@/lib/types'
import { readImageText } from '@/lib/ai'
import { assembleScannedBook, renderBookPages } from '@/lib/books'
import { getStorage } from '@/lib/storage'
import { AgentInputError } from '@/lib/generation/errors'
import * as courseBookService from '@/services/course-book.service'
import { assertJobLive } from './define-agent'
import { courseAgentInputSchema } from './course-context'

export const bookPagesInputSchema = z.object({
  courseId: z.string().min(1),
  startPage: z.number().int().min(1),
  endPage: z.number().int().min(1),
})

const PAGE_OUTPUT_TOKENS = 4_000
const TRANSCRIBE_INSTRUCTION = [
  'This is one page of a scanned study book.',
  'Transcribe all of its text exactly, in reading order.',
  'Put each heading on its own line, keep numbered lists and tables row by row (cells separated by " | "), and keep formulas and numbers exactly as printed.',
  'Return only the text of the page, with no commentary. If the page is blank, return nothing.',
].join(' ')

async function loadBook(db: AgentInputContext['db'], courseId: string) {
  const book = await courseBookService.findBookForAgent(db, courseId)
  if (!book) throw new AgentInputError('This course no longer has a course book.')
  const stored = await getStorage().get(book.asset.storageKey)
  if (!stored) throw new AgentInputError('The course book file is missing. Upload it again.')
  return { book, bytes: stored.body }
}

type AgentInputContext = Parameters<AgentDefinition['execute']>[0]

export const bookPageReaderAgent: AgentDefinition = {
  name: 'Book Page Reader',
  description: 'Reads scanned book pages with a vision model',
  capability: AiCapability.VISION,

  async execute(execution) {
    const parsed = bookPagesInputSchema.safeParse(execution.task.input)
    if (!parsed.success) throw new AgentInputError('Task input for Book Page Reader is invalid.')
    const { courseId, startPage, endPage } = parsed.data
    const { book, bytes } = await loadBook(execution.db, courseId)
    const last = Math.min(endPage, book.pageCount)
    const pageNumbers = Array.from({ length: Math.max(0, last - startPage + 1) }, (_, i) => startPage + i)

    let characters = 0
    for (const { page, dataUrl } of await renderBookPages(bytes, pageNumbers)) {
      const result = await readImageText({
        context: {
          organizationId: execution.job.organizationId,
          agentId: execution.task.agentId,
          courseId,
          lessonId: null,
          jobId: execution.job.id,
          taskId: execution.task.id,
        },
        imageDataUrl: dataUrl,
        instruction: TRANSCRIBE_INSTRUCTION,
        maxOutputTokens: PAGE_OUTPUT_TOKENS,
      })
      await assertJobLive(execution.db, execution.job.id)
      await courseBookService.saveScannedPage(execution.db, book.id, page, result.data.trim())
      characters += result.data.length
    }
    return { output: { pages: pageNumbers.length, characters } }
  },
}

export const bookAssemblerAgent: AgentDefinition = {
  name: 'Book Assembler',
  description: 'Builds chapters from the read pages of a scanned book',
  capability: AiCapability.FAST_TEXT,

  async execute(execution) {
    const parsed = courseAgentInputSchema.safeParse(execution.task.input)
    if (!parsed.success) throw new AgentInputError('Task input for Book Assembler is invalid.')
    const { book, bytes } = await loadBook(execution.db, parsed.data.courseId)
    const pages = await courseBookService.listScannedPages(execution.db, book.id)
    if (pages.length < book.pageCount) {
      throw new AgentInputError(`Only ${pages.length} of ${book.pageCount} pages have been read. Retry the failed page tasks first.`)
    }
    const texts = Array.from({ length: book.pageCount }, (_, i) => pages.find((p) => p.page === i + 1)?.text ?? '')
    const chapters = await assembleScannedBook(bytes, texts)
    await assertJobLive(execution.db, execution.job.id)
    await courseBookService.finishScannedBook(execution.db, book.id, chapters)
    return { output: { chapters: chapters.length, selected: chapters.filter((c) => c.selected).length } }
  },
}
