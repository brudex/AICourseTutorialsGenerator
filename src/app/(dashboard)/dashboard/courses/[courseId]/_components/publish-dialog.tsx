'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: PublishDialog, publish course dialog, choose
 *   connection, YouTube privacy options, Classroom class name, Canvas course
 *   picker, publishing.publish
 *
 * WHAT:  Publishes the course to one connected platform: pick the connection,
 *        set that platform's options, start. The upload runs in the worker
 *        (Activity tab) and the publications card shows progress and the link.
 * WHY:   Two steps keep each platform's options typed by its own Zod schema:
 *        the connection choice decides which options form appears. With no
 *        connection yet, it points to Settings → Connections instead.
 * WHERE: CourseWorkspace (Publish button) and PublicationsCard (Publish again).
 */

import * as React from 'react'
import Link from 'next/link'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { PublishingPlatform } from '@/generated/prisma'
import { useOnlineStatus } from '@/hooks/use-online-status'
import { OFFLINE_ACTION_HINT } from '@/components/global/connection-status'
import { trpc } from '@/trpc/react-provider'
import { PUBLISHING_PLATFORMS } from '@/lib/config/publishing'
import { RESOURCES } from '@/lib/resources'
import {
  canvasOptionsSchema,
  chooseConnectionSchema,
  classroomOptionsSchema,
  driveOptionsSchema,
  LEARNDASH_STATUSES,
  learndashOptionsSchema,
  schoolOptionsSchema,
  VIMEO_PRIVACY_VIEWS,
  vimeoOptionsSchema,
  YOUTUBE_PRIVACY_STATUSES,
  youtubeOptionsSchema,
  type CanvasOptions,
  type ChooseConnectionValues,
  type ClassroomOptions,
  type DriveOptions,
  type LearndashOptions,
  type SchoolPublishOptions,
  type PublicationOptions,
  type VimeoOptions,
  type YoutubeOptions,
} from '@/lib/types'
import { PublishingPlatformIcon } from '@/components/global/publishing'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

const PRIVACY_LABELS: Record<YoutubeOptions['privacy'], string> = {
  private: 'Private: only you',
  unlisted: 'Unlisted: anyone with the link',
  public: 'Public: everyone',
}

const VIMEO_PRIVACY_LABELS: Record<VimeoOptions['privacy'], string> = {
  anybody: 'Public: everyone',
  unlisted: 'Unlisted: anyone with the link (paid Vimeo plans)',
  nobody: 'Private: only you',
}

const LEARNDASH_STATUS_LABELS: Record<LearndashOptions['status'], string> = {
  publish: 'Publish now',
  draft: 'Save as draft to review first',
}

export interface PublishDialogProps {
  organizationId: string
  courseId: string
  courseTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Preselect a connection (Publish again). */
  connectionId?: string | undefined
  onStarted: () => void
}

export function PublishDialog(props: PublishDialogProps) {
  const { organizationId, open, onOpenChange } = props
  const setup = trpc.publishing.getSetup.useQuery({ organizationId }, { enabled: open && organizationId !== '' })
  const connections = setup.data?.connections ?? []
  const form = useForm<ChooseConnectionValues>({
    resolver: zodResolver(chooseConnectionSchema),
    defaultValues: { connectionId: props.connectionId ?? '' },
  })
  const connectionId = useWatch({ control: form.control, name: 'connectionId' })
  const connection = connections.find((c) => c.id === connectionId) ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Publish course</DialogTitle>
          <DialogDescription>Uploads run in the background. Follow them in the Activity tab.</DialogDescription>
        </DialogHeader>

        {setup.isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : connections.length === 0 ? (
          <div className="space-y-3 rounded-xl border border-dashed p-6 text-sm">
            <p className="font-medium">No platform is connected yet</p>
            <p className="text-muted-foreground">Connect YouTube, Google Classroom or Canvas first.</p>
            <Link href={RESOURCES.publishing.nav.href} className={buttonVariants({ variant: 'outline' })}>
              Open Connections
            </Link>
          </div>
        ) : (
          <div className="space-y-5">
            <Form {...form}>
              <FormField
                control={form.control}
                name="connectionId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Publish to</FormLabel>
                    <Select value={field.value} onValueChange={(value) => field.onChange(value ?? '')}>
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose a connected platform">
                            {(value: string) => {
                              const chosen = connections.find((c) => c.id === value)
                              return chosen ? `${PUBLISHING_PLATFORMS[chosen.platform].label} · ${chosen.name}` : 'Choose a connected platform'
                            }}
                          </SelectValue>
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {connections.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {PUBLISHING_PLATFORMS[c.platform].label} · {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </Form>

            {connection ? (
              <div className="flex gap-3 rounded-xl border bg-card p-3 text-sm">
                <PublishingPlatformIcon platform={connection.platform} />
                <p className="text-muted-foreground">{PUBLISHING_PLATFORMS[connection.platform].creates}</p>
              </div>
            ) : null}

            {/* key remounts the options form with fresh defaults per connection. */}
            {connection?.platform === PublishingPlatform.YOUTUBE ? (
              <YoutubeOptionsForm key={connection.id} {...props} connectionId={connection.id} />
            ) : connection?.platform === PublishingPlatform.GOOGLE_CLASSROOM ? (
              <ClassroomOptionsForm key={connection.id} {...props} connectionId={connection.id} />
            ) : connection?.platform === PublishingPlatform.CANVAS ? (
              <CanvasOptionsForm key={connection.id} {...props} connectionId={connection.id} />
            ) : connection?.platform === PublishingPlatform.VIMEO ? (
              <VimeoOptionsForm key={connection.id} {...props} connectionId={connection.id} />
            ) : connection?.platform === PublishingPlatform.GOOGLE_DRIVE ? (
              <DriveOptionsForm key={connection.id} {...props} connectionId={connection.id} />
            ) : connection?.platform === PublishingPlatform.LEARNDASH ? (
              <LearndashOptionsForm key={connection.id} {...props} connectionId={connection.id} />
            ) : connection?.platform === PublishingPlatform.SCHOOL ? (
              <SchoolOptionsForm key={connection.id} {...props} connectionId={connection.id} />
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* Shared submit: queues the publish job, refreshes the card, closes. */
function usePublish(props: PublishDialogProps & { connectionId: string }) {
  const utils = trpc.useUtils()
  const publish = trpc.publishing.publish.useMutation()
  const [error, setError] = React.useState<string | null>(null)
  async function submit(options: PublicationOptions) {
    setError(null)
    try {
      await publish.mutateAsync({ organizationId: props.organizationId, courseId: props.courseId, connectionId: props.connectionId, options })
      await utils.publishing.publications.invalidate({ organizationId: props.organizationId, courseId: props.courseId })
      toast.success('Publishing started. Follow it in the Activity tab.')
      props.onStarted()
      props.onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start publishing.')
    }
  }
  return { submit, error, pending: publish.isPending }
}

function SubmitRow({ pending, error, onCancel }: { pending: boolean; error: string | null; onCancel: () => void }) {
  /* Publishing needs the internet; offline the button waits, with the reason on hover. */
  const online = useOnlineStatus()
  return (
    <>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending || !online} title={online ? undefined : OFFLINE_ACTION_HINT}>
          {pending ? <Loader2Icon className="size-4 animate-spin" /> : null}
          Publish
        </Button>
      </DialogFooter>
    </>
  )
}

function YoutubeOptionsForm(props: PublishDialogProps & { connectionId: string }) {
  const { submit, error, pending } = usePublish(props)
  const form = useForm<YoutubeOptions>({
    resolver: zodResolver(youtubeOptionsSchema),
    defaultValues: { platform: PublishingPlatform.YOUTUBE, privacy: 'private', madeForKids: false },
  })
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
        <FormField
          control={form.control}
          name="privacy"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Who can watch</FormLabel>
              <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(value: YoutubeOptions['privacy']) => PRIVACY_LABELS[value]}</SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {YOUTUBE_PRIVACY_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {PRIVACY_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormDescription>Until Google reviews your Google app, YouTube may keep uploads private.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="madeForKids"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start gap-3">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
              </FormControl>
              <div className="space-y-1">
                <FormLabel className="font-normal">Made for kids</FormLabel>
                <FormDescription>YouTube requires this answer for every upload.</FormDescription>
              </div>
            </FormItem>
          )}
        />
        <SubmitRow pending={pending} error={error} onCancel={() => props.onOpenChange(false)} />
      </form>
    </Form>
  )
}

function ClassroomOptionsForm(props: PublishDialogProps & { connectionId: string }) {
  const { submit, error, pending } = usePublish(props)
  const form = useForm<ClassroomOptions>({
    resolver: zodResolver(classroomOptionsSchema),
    defaultValues: { platform: PublishingPlatform.GOOGLE_CLASSROOM, className: props.courseTitle.slice(0, 120), section: '' },
  })
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
        <FormField
          control={form.control}
          name="className"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Class name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="section"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Section (optional)</FormLabel>
              <FormControl>
                <Input placeholder="For example: Year 2, Group A" {...field} />
              </FormControl>
              <FormDescription>Publish to YouTube first to attach the lecture videos.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <SubmitRow pending={pending} error={error} onCancel={() => props.onOpenChange(false)} />
      </form>
    </Form>
  )
}

function CanvasOptionsForm(props: PublishDialogProps & { connectionId: string }) {
  const { submit, error, pending } = usePublish(props)
  const courses = trpc.publishing.canvasCourses.useQuery({ organizationId: props.organizationId, connectionId: props.connectionId })
  const form = useForm<CanvasOptions>({
    resolver: zodResolver(canvasOptionsSchema),
    defaultValues: { platform: PublishingPlatform.CANVAS, canvasCourseId: '' },
  })
  const list = courses.data ?? []
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
        <FormField
          control={form.control}
          name="canvasCourseId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Canvas course</FormLabel>
              {courses.isLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select value={field.value} onValueChange={(value) => field.onChange(value ?? '')}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a course you teach">
                        {(value: string) => list.find((c) => c.id === value)?.name ?? 'Choose a course you teach'}
                      </SelectValue>
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {list.map((course) => (
                      <SelectItem key={course.id} value={course.id}>
                        {course.name}
                        {course.code ? ` (${course.code})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <FormDescription>
                {courses.error ? courses.error.message : list.length === 0 && !courses.isLoading ? 'You do not teach any Canvas course yet. Ask your Canvas admin for one.' : 'Modules, pages, videos and quizzes are added to this course.'}
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <SubmitRow pending={pending} error={error} onCancel={() => props.onOpenChange(false)} />
      </form>
    </Form>
  )
}

function VimeoOptionsForm(props: PublishDialogProps & { connectionId: string }) {
  const { submit, error, pending } = usePublish(props)
  const form = useForm<VimeoOptions>({
    resolver: zodResolver(vimeoOptionsSchema),
    defaultValues: { platform: PublishingPlatform.VIMEO, privacy: 'anybody' },
  })
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
        <FormField
          control={form.control}
          name="privacy"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Who can watch</FormLabel>
              <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(value: VimeoOptions['privacy']) => VIMEO_PRIVACY_LABELS[value]}</SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {VIMEO_PRIVACY_VIEWS.map((view) => (
                    <SelectItem key={view} value={view}>
                      {VIMEO_PRIVACY_LABELS[view]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <SubmitRow pending={pending} error={error} onCancel={() => props.onOpenChange(false)} />
      </form>
    </Form>
  )
}

function DriveOptionsForm(props: PublishDialogProps & { connectionId: string }) {
  const { submit, error, pending } = usePublish(props)
  const form = useForm<DriveOptions>({
    resolver: zodResolver(driveOptionsSchema),
    defaultValues: { platform: PublishingPlatform.GOOGLE_DRIVE, folderName: props.courseTitle.slice(0, 200) },
  })
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
        <FormField
          control={form.control}
          name="folderName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Folder name</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>Created in your Drive. Publishing again adds anything missing to the same folder.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <SubmitRow pending={pending} error={error} onCancel={() => props.onOpenChange(false)} />
      </form>
    </Form>
  )
}

function LearndashOptionsForm(props: PublishDialogProps & { connectionId: string }) {
  const { submit, error, pending } = usePublish(props)
  const form = useForm<LearndashOptions>({
    resolver: zodResolver(learndashOptionsSchema),
    defaultValues: { platform: PublishingPlatform.LEARNDASH, status: 'draft' },
  })
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
        <FormField
          control={form.control}
          name="status"
          render={({ field }) => (
            <FormItem>
              <FormLabel>When it goes live</FormLabel>
              <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue>{(value: LearndashOptions['status']) => LEARNDASH_STATUS_LABELS[value]}</SelectValue>
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {LEARNDASH_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {LEARNDASH_STATUS_LABELS[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <SubmitRow pending={pending} error={error} onCancel={() => props.onOpenChange(false)} />
      </form>
    </Form>
  )
}

/* Your online school: list the course straight away, and whether anyone may enroll. */
const SCHOOL_SWITCHES: ReadonlyArray<{ name: 'listInSchool' | 'openEnrollment'; label: string; description: string }> = [
  { name: 'listInSchool', label: 'List it in your school', description: 'Students can find and open the course. Off: send it now, list it later.' },
  { name: 'openEnrollment', label: 'Anyone can enroll', description: 'Off: invitation, link or API only.' },
]

function SchoolOptionsForm(props: PublishDialogProps & { connectionId: string }) {
  const { submit, error, pending } = usePublish(props)
  const form = useForm<SchoolPublishOptions>({
    resolver: zodResolver(schoolOptionsSchema),
    defaultValues: { platform: PublishingPlatform.SCHOOL, listInSchool: true, openEnrollment: true },
  })
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
        {SCHOOL_SWITCHES.map((item) => (
          <FormField
            key={item.name}
            control={form.control}
            name={item.name}
            render={({ field }) => (
              <FormItem className="flex items-center justify-between gap-4 rounded-lg border p-3">
                <div className="space-y-0.5">
                  <FormLabel>{item.label}</FormLabel>
                  <FormDescription>{item.description}</FormDescription>
                </div>
                <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} /></FormControl>
              </FormItem>
            )}
          />
        ))}
        <p className="text-xs text-muted-foreground">Publishing again updates the course there and keeps students’ progress.</p>
        <SubmitRow pending={pending} error={error} onCancel={() => props.onOpenChange(false)} />
      </form>
    </Form>
  )
}
