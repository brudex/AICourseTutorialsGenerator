'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: CourseBookCard, CourseBookUploadForm,
 *   BookChapterPicker, course book chapters, tick chapters, plan from book
 *
 * WHAT:  The course book on the course Overview: upload a PDF, see the
 *        chapters it was read into, tick the ones this course covers, then
 *        plan the curriculum from them. Replace or remove the book until the
 *        curriculum is approved; afterwards the ticked chapters are read only.
 *        A scanned book shows page reading progress (polled) until its
 *        chapters are built.
 * WHY:   A study text is usually far longer than one course, so the author
 *        chooses its scope here before any agent runs. Both forms use React
 *        Hook Form with the shared Zod schemas; the router re-checks every
 *        rule (approval, live jobs, chapter ownership).
 * WHERE: CourseWorkspace → Overview tab.
 */

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { BookOpenIcon, Loader2Icon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'

import { trpc } from '@/trpc/react-provider'
import { formatBytes, formatPageRange } from '@/lib/utils'
import {
  COURSE_BOOK_LIMITS,
  bookChaptersFormSchema,
  courseBookUploadFormSchema,
  type BookChaptersFormValues,
  type CourseBookUploadFormValues,
  type CourseBookView,
} from '@/lib/types'
import { FileDropInput } from '@/components/global/file-drop'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface CourseBookCardProps {
  organizationId: string
  courseId: string
  /** The author may change the book (permission, not approved, no live job). */
  editable: boolean
  /** Planning may start now; the picker then saves and plans in one step. */
  canPlan: boolean
  onPlan: () => Promise<void>
  onChanged: () => void
}

function CourseBookUploadForm({
  organizationId,
  courseId,
  onUploaded,
  onCancel,
}: {
  organizationId: string
  courseId: string
  onUploaded: () => void
  onCancel?: () => void
}) {
  const upload = trpc.courseBooks.upload.useMutation()
  const form = useForm<CourseBookUploadFormValues>({ resolver: zodResolver(courseBookUploadFormSchema) })

  async function onSubmit({ file }: CourseBookUploadFormValues) {
    const data = new FormData()
    data.set('organizationId', organizationId)
    data.set('courseId', courseId)
    data.set('file', file)
    try {
      const result = await upload.mutateAsync(data)
      toast.success(`Read ${result.pageCount} pages into ${result.chapters} chapters.`)
      onUploaded()
    } catch (err) {
      form.setError('file', { message: err instanceof Error ? err.message : 'Could not read the course book.' })
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-3">
        <FormField
          control={form.control}
          name="file"
          render={({ field }) => (
            <FormItem>
              <FormControl>
                <FileDropInput
                  id="course-book-upload"
                  value={field.value ?? null}
                  onChange={field.onChange}
                  accept={COURSE_BOOK_LIMITS.mimeType}
                  label="Upload a course book (PDF)"
                  hint={`A study text or manual, up to ${COURSE_BOOK_LIMITS.maxMegabytes} MB. Sections follow its chapters.`}
                  disabled={upload.isPending}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={upload.isPending}>
            {upload.isPending ? <Loader2Icon className="size-4 animate-spin" /> : <BookOpenIcon className="size-4" />}
            {upload.isPending ? 'Reading your book…' : 'Read book'}
          </Button>
          {onCancel ? (
            <Button type="button" variant="ghost" disabled={upload.isPending} onClick={onCancel}>
              Cancel
            </Button>
          ) : null}
        </div>
      </form>
    </Form>
  )
}

function BookChapterPicker({
  organizationId,
  courseId,
  book,
  editable,
  canPlan,
  onPlan,
  onSaved,
}: {
  organizationId: string
  courseId: string
  book: CourseBookView
  editable: boolean
  canPlan: boolean
  onPlan: () => Promise<void>
  onSaved: () => void
}) {
  const select = trpc.courseBooks.selectChapters.useMutation()
  const form = useForm<BookChaptersFormValues>({
    resolver: zodResolver(bookChaptersFormSchema),
    defaultValues: { chapterIds: book.chapters.filter((c) => c.selected).map((c) => c.id) },
  })
  const [planning, setPlanning] = React.useState(false)

  async function onSubmit(values: BookChaptersFormValues) {
    try {
      await select.mutateAsync({ organizationId, courseId, ...values })
      onSaved()
      if (canPlan) {
        setPlanning(true)
        await onPlan()
      } else {
        toast.success('Chapters saved.')
      }
    } catch (err) {
      form.setError('chapterIds', { message: err instanceof Error ? err.message : 'Could not save the chapters.' })
    } finally {
      setPlanning(false)
    }
  }

  const busy = select.isPending || planning

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-3">
        <FormField
          control={form.control}
          name="chapterIds"
          render={({ field }) => (
            <FormItem>
              {editable ? (
                <div className="flex gap-2 text-xs">
                  <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => field.onChange(book.chapters.map((c) => c.id))}>
                    Tick all
                  </Button>
                  <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => field.onChange([])}>
                    Clear
                  </Button>
                </div>
              ) : null}
              <ul className="max-h-96 divide-y overflow-y-auto rounded-lg border">
                {book.chapters.map((chapter) => {
                  const checked = field.value.includes(chapter.id)
                  return (
                    <li key={chapter.id}>
                      <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5 hover:bg-muted/50">
                        <Checkbox
                          className="mt-0.5"
                          checked={checked}
                          disabled={!editable || busy}
                          onCheckedChange={(next) =>
                            field.onChange(next ? [...field.value, chapter.id] : field.value.filter((id) => id !== chapter.id))
                          }
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium">{chapter.title}</span>
                          <span className="block text-xs text-muted-foreground">
                            Pages {formatPageRange(chapter.startPage, chapter.endPage)}
                            {chapter.topics.length > 0 ? ` · ${chapter.topics.length} topics` : ''}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
              <FormMessage />
            </FormItem>
          )}
        />
        {editable ? (
          <Button type="submit" disabled={busy}>
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
            {canPlan ? 'Save chapters and plan curriculum' : 'Save chapters'}
          </Button>
        ) : null}
      </form>
    </Form>
  )
}

export function CourseBookCard({ organizationId, courseId, editable, canPlan, onPlan, onChanged }: CourseBookCardProps) {
  const utils = trpc.useUtils()
  const bookQuery = trpc.courseBooks.get.useQuery(
    { organizationId, courseId },
    /* While a scanned book is being read, follow its page progress. */
    { refetchInterval: (query) => (query.state.data?.status === 'READING' ? 4_000 : false) }
  )
  const wasReading = React.useRef(false)
  const remove = trpc.courseBooks.remove.useMutation()
  const [replacing, setReplacing] = React.useState(false)
  const [confirmRemove, setConfirmRemove] = React.useState(false)

  const changed = React.useCallback(() => {
    void utils.courseBooks.get.invalidate({ organizationId, courseId })
    onChanged()
  }, [utils, organizationId, courseId, onChanged])

  async function removeBook() {
    try {
      await remove.mutateAsync({ organizationId, courseId })
      changed()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove the course book.')
    } finally {
      setConfirmRemove(false)
    }
  }

  const book = bookQuery.data ?? null
  /* Reading just finished: refresh the course so planning progress shows. */
  const reading = book?.status === 'READING'
  React.useEffect(() => {
    if (wasReading.current && !reading) onChanged()
    wasReading.current = reading
  }, [reading, onChanged])
  if (bookQuery.isLoading) return null
  const canEdit = editable && (book?.editable ?? true)
  if (!book && !canEdit) return null

  const ticked = book?.chapters.filter((c) => c.selected).length ?? 0

  /* OPTIONAL_BOOK — a course started from a topic has no book, and most never
   * need one. Offer it as one quiet row instead of a full upload panel; the
   * uploader opens only when asked for. */
  if (!book && !replacing) {
    return (
      <Card size="sm">
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-medium">Course book (optional)</p>
              <p className="text-sm text-muted-foreground">Add a study text and the sections will follow its chapters.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setReplacing(true)}>
            Add a book
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpenIcon className="size-4 shrink-0" />
              <span className="truncate">{book ? book.title : 'Course book'}</span>
            </CardTitle>
            <CardDescription>
              {book
                ? reading
                  ? `Scanned book · reading page ${book.pagesRead} of ${book.pageCount}`
                  : `${book.pageCount} pages · ${formatBytes(book.asset.bytes)} · ${ticked} of ${book.chapters.length} chapters ticked`
                : 'Build this course from a study text. Sections follow its chapters.'}
            </CardDescription>
          </div>
          {book && canEdit && !replacing ? (
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={() => setReplacing(true)}>
                Replace
              </Button>
              <Button variant="ghost" size="sm" disabled={remove.isPending} onClick={() => setConfirmRemove(true)}>
                Remove
              </Button>
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="pt-5">
        {book && reading ? (
          <div className="space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${book.pageCount > 0 ? Math.round((book.pagesRead / book.pageCount) * 100) : 0}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              A vision model is reading each page. Chapters appear when it finishes; failed pages can be retried in the
              Activity tab.
            </p>
          </div>
        ) : !book || replacing ? (
          <CourseBookUploadForm
            organizationId={organizationId}
            courseId={courseId}
            onUploaded={() => {
              setReplacing(false)
              changed()
            }}
            onCancel={() => setReplacing(false)}
          />
        ) : (
          <BookChapterPicker
            key={`${book.id}-${book.createdAt.toString()}`}
            organizationId={organizationId}
            courseId={courseId}
            book={book}
            editable={canEdit}
            canPlan={canPlan}
            onPlan={onPlan}
            onSaved={changed}
          />
        )}
      </CardContent>

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the course book?</AlertDialogTitle>
            <AlertDialogDescription>
              The PDF and its chapters are deleted. A curriculum already planned from it stays, but new lessons will no longer read the book.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep book</AlertDialogCancel>
            <AlertDialogAction onClick={() => void removeBook()}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
