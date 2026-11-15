'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: ModuleFormDialog, LessonFormDialog, curriculum
 *   item editing, moduleFieldsSchema, lessonFieldsSchema
 *
 * WHAT:  Create/edit dialogs for curriculum modules and lessons.
 * WHY:   Each dialog validates only the editable fields, picked from the
 *        router's own schemas (updateModuleSchema / updateLessonSchema) so
 *        client and server rules are identical. One dialog serves create and
 *        edit; the caller decides which mutation runs.
 * WHERE: CurriculumEditor.
 */

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import type { z } from 'zod'

import { LECTURE_LIMITS, updateLessonSchema, updateModuleSchema } from '@/lib/types'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const moduleFieldsSchema = updateModuleSchema.pick({ title: true, summary: true })
const lessonFieldsSchema = updateLessonSchema.pick({ title: true, estimatedMinutes: true })
type ModuleFields = z.infer<typeof moduleFieldsSchema>
type LessonFields = z.infer<typeof lessonFieldsSchema>

interface DialogShellProps<T> {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  initial: T
  onSave: (values: T) => Promise<void>
}

export function ModuleFormDialog({ open, onOpenChange, title, initial, onSave }: DialogShellProps<ModuleFields>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Modules group related lessons.</DialogDescription>
        </DialogHeader>
        {open ? <ModuleForm initial={initial} onSave={onSave} onCancel={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function ModuleForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: ModuleFields
  onSave: (values: ModuleFields) => Promise<void>
  onCancel: () => void
}) {
  const [error, setError] = React.useState<string | null>(null)
  const form = useForm<ModuleFields>({ resolver: zodResolver(moduleFieldsSchema), defaultValues: initial })

  async function submit(values: ModuleFields) {
    setError(null)
    try {
      await onSave(values)
      onCancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
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
          name="summary"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Summary</FormLabel>
              <FormControl>
                <Textarea rows={3} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}

export function LessonFormDialog({ open, onOpenChange, title, initial, onSave }: DialogShellProps<LessonFields>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Lessons are focused single topics, usually 5–20 minutes.</DialogDescription>
        </DialogHeader>
        {open ? <LessonForm initial={initial} onSave={onSave} onCancel={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

function LessonForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: LessonFields
  onSave: (values: LessonFields) => Promise<void>
  onCancel: () => void
}) {
  const [error, setError] = React.useState<string | null>(null)
  const form = useForm<LessonFields>({ resolver: zodResolver(lessonFieldsSchema), defaultValues: initial })

  async function submit(values: LessonFields) {
    setError(null)
    try {
      await onSave(values)
      onCancel()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.')
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
          name="estimatedMinutes"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Duration (minutes)</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min={1}
                  max={LECTURE_LIMITS.maxMinutes}
                  {...field}
                  onChange={(e) => field.onChange(e.target.valueAsNumber)}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Save
          </Button>
        </DialogFooter>
      </form>
    </Form>
  )
}
