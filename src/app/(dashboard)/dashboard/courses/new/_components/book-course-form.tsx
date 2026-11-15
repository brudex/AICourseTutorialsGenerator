'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: BookCourseForm, book-first course, create course
 *   from book, autopilot, upload study text
 *
 * WHAT:  New course from a course book: the author uploads the PDF and picks
 *        the learner level (optionally refined, plus a teaching style).
 *        Submit creates the course with a working brief, uploads the book
 *        with autopilot on, and opens the course, where the agents carry on:
 *        reading (scanned books), the Brief Writer, research, curriculum, and
 *        the full build, with no approval stop.
 * WHY:   The book already defines the topic and scope, so asking for them
 *        again is busywork. Who the course is for is the author's decision
 *        (the same book can be taught to juniors or graduates), so the level
 *        is asked before anything is generated; the Brief Writer keeps it.
 *        The working brief (title from the file
 *        name) only exists to create the course; the Brief Writer replaces it.
 *        courses.create is still called first so plan limits and usage
 *        counting apply as for any course.
 * WHERE: /dashboard/courses/new ("From a course book" tab).
 */

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { BookOpenIcon, FileSearchIcon, Loader2Icon, SparklesIcon, WandSparklesIcon } from 'lucide-react'
import { toast } from 'sonner'

import { useOnlineStatus } from '@/hooks/use-online-status'
import { OFFLINE_ACTION_HINT } from '@/components/global/connection-status'
import { trpc } from '@/trpc/react-provider'
import { useActiveOrganizationId } from '@/hooks/use-active-organization'
import {
  COURSE_BOOK_LIMITS,
  bookCourseFormSchema,
  type AudienceProfile,
  type BookCourseFormValues,
  type CourseBrief,
} from '@/lib/types'
import { defaultAudienceProfile, learnerLevelGuide } from '@/lib/config/learner-levels'
import { AudienceProfileFields, TeachingStyleSuggestions } from '@/components/global/audience-profile'
import { FileDropInput } from '@/components/global/file-drop'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'

/* Replaced by the Brief Writer as soon as the book is read. */
function workingBrief(fileName: string, audienceProfile: AudienceProfile, teachingStyle: string): CourseBrief {
  const title = fileName.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim()
  return {
    topic: title.length >= 3 ? title.slice(0, 200) : 'Course from book',
    description: '',
    audience: 'Learners of this book',
    audienceProfile,
    difficulty: 'intermediate',
    language: 'English',
    /* Empty lets the Brief Writer suggest one for the level. */
    teachingStyle,
    targetDurationMinutes: 120,
    includes: { exercises: true, quizzes: true, projects: true },
    sourceMaterial: '',
  }
}

const STEPS = [
  { icon: FileSearchIcon, title: 'Read the book', description: 'Chapters and topics are found. Scanned pages are read by a vision model.' },
  { icon: WandSparklesIcon, title: 'Write the brief', description: 'Title and length come from the book, pitched at your learners.' },
  { icon: BookOpenIcon, title: 'Plan and build', description: 'One section per chapter, then lectures, videos, quizzes and downloads.' },
] as const

export function BookCourseForm() {
  const router = useRouter()
  const organizationId = useActiveOrganizationId()
  const create = trpc.courses.create.useMutation()
  const online = useOnlineStatus()
  const upload = trpc.courseBooks.upload.useMutation()
  const form = useForm<BookCourseFormValues>({
    resolver: zodResolver(bookCourseFormSchema),
    defaultValues: { organizationId: organizationId ?? '', audienceProfile: defaultAudienceProfile(), teachingStyle: '' },
  })
  const level = useWatch({ control: form.control, name: 'audienceProfile.level' })

  React.useEffect(() => {
    if (organizationId) form.setValue('organizationId', organizationId)
  }, [organizationId, form])

  async function onSubmit({ organizationId: orgId, book, audienceProfile, teachingStyle }: BookCourseFormValues) {
    let courseId: string
    try {
      courseId = (await create.mutateAsync({ organizationId: orgId, brief: workingBrief(book.name, audienceProfile, teachingStyle) })).id
    } catch (err) {
      form.setError('book', { message: err instanceof Error ? err.message : 'Could not create the course.' })
      return
    }
    const data = new FormData()
    data.set('organizationId', orgId)
    data.set('courseId', courseId)
    data.set('file', book)
    data.set('autopilot', 'true')
    try {
      const result = await upload.mutateAsync(data)
      toast.success(
        result.scanned
          ? `Scanned book with ${result.pageCount} pages. Reading it now, then the course builds itself.`
          : `Read ${result.pageCount} pages into ${result.chapters} chapters. The course is being built.`
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read the course book.')
    }
    router.push(`/dashboard/courses/${courseId}`)
  }

  const pending = create.isPending || upload.isPending

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="text-base">Upload your course book</CardTitle>
          <CardDescription>A study text or manual. Text and scanned PDFs both work.</CardDescription>
        </CardHeader>
        <CardContent className="pt-5">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="space-y-5">
              <FormField
                control={form.control}
                name="book"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <FileDropInput
                        id="book-first-upload"
                        value={field.value ?? null}
                        onChange={field.onChange}
                        accept={COURSE_BOOK_LIMITS.mimeType}
                        label="Drop the PDF here or click to choose"
                        hint={`Up to ${COURSE_BOOK_LIMITS.maxMegabytes} MB.`}
                        disabled={pending}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="audienceProfile"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Who is it for?</FormLabel>
                    <AudienceProfileFields value={field.value} onChange={field.onChange} disabled={pending} />
                    <FormDescription>Lessons, videos, pictures and quizzes adapt to this level.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="teachingStyle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teaching style</FormLabel>
                    <FormControl>
                      <Input placeholder="Suggested from the book if left empty" disabled={pending} {...field} />
                    </FormControl>
                    <TeachingStyleSuggestions
                      suggestions={learnerLevelGuide(level).teachingStyles}
                      value={field.value}
                      onChange={field.onChange}
                      disabled={pending}
                      clearable
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" size="lg" disabled={pending || !organizationId || !online} title={online ? undefined : OFFLINE_ACTION_HINT}>
                {pending ? <Loader2Icon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
                {upload.isPending ? 'Reading your book…' : 'Create course from book'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card className="lg:self-start">
        <CardHeader className="border-b">
          <CardTitle className="text-base">What happens next</CardTitle>
        </CardHeader>
        <CardContent className="pt-5">
          <ol className="space-y-4">
            {STEPS.map((step) => (
              <li key={step.title} className="flex gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <step.icon className="size-4" />
                </span>
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium">{step.title}</span>
                  <span className="block text-xs text-muted-foreground">{step.description}</span>
                </span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  )
}
