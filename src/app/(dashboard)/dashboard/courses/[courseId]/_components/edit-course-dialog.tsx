'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: EditCourseDialog, edit course details, edit
 *   course title, edit course description, switch learner level,
 *   courseDetailsSchema, courses.update
 *
 * WHAT:  Edits what learners see about a course (title, subtitle,
 *        description) and who it is for (learner level and refinements).
 * WHY:   Titles and descriptions written by the agents often need a human
 *        touch, and courses made before audience specialization (or for the
 *        wrong level) must be switchable before regenerating. Validated with
 *        courseDetailsSchema, the same schema courses.update uses; the level
 *        is merged into the stored brief server side, so only generations
 *        started after saving follow it.
 * WHERE: CourseWorkspace header ("Edit details").
 */

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { trpc } from '@/trpc/react-provider'
import { courseDetailsSchema, type CourseDetailsValues } from '@/lib/types'
import { AudienceProfileFields } from '@/components/global/audience-profile'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export interface EditCourseDialogProps {
  organizationId: string
  courseId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: CourseDetailsValues
}

export function EditCourseDialog({ organizationId, courseId, open, onOpenChange, initial }: EditCourseDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Edit course details</DialogTitle>
          <DialogDescription>What learners see, and who the course is for.</DialogDescription>
        </DialogHeader>
        {open ? (
          <EditCourseForm organizationId={organizationId} courseId={courseId} initial={initial} onDone={() => onOpenChange(false)} />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function EditCourseForm({
  organizationId,
  courseId,
  initial,
  onDone,
}: Omit<EditCourseDialogProps, 'open' | 'onOpenChange'> & { onDone: () => void }) {
  const utils = trpc.useUtils()
  const update = trpc.courses.update.useMutation()
  const [error, setError] = React.useState<string | null>(null)
  const form = useForm<CourseDetailsValues>({ resolver: zodResolver(courseDetailsSchema), defaultValues: initial })

  async function submit(values: CourseDetailsValues) {
    setError(null)
    try {
      await update.mutateAsync({ organizationId, courseId, ...values })
      await utils.courses.get.invalidate({ organizationId, courseId })
      const levelChanged = values.audienceProfile.level !== initial.audienceProfile.level
      toast.success(levelChanged ? 'Saved. Regenerate the lessons to rewrite them for the new level.' : 'Course details saved.')
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the course.')
    }
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Title</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="subtitle"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Subtitle</FormLabel>
              <FormControl>
                <Input maxLength={120} placeholder="One line under the title" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea rows={6} placeholder="What the course covers and who it helps" {...field} />
              </FormControl>
              <FormDescription>Shown on the landing page and in exports.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="audienceProfile"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Learner level</FormLabel>
              <AudienceProfileFields value={field.value} onChange={field.onChange} />
              <FormDescription>New lessons, videos, pictures and quizzes follow this level.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={update.isPending}>
            {update.isPending ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
