'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: CourseWorkspace, course detail page, plan
 *   curriculum, re-plan, approve curriculum, research findings
 *
 * WHAT:  One course's workspace: status and actions (plan / re-plan /
 *        approve / generate lessons), live agent activity, readiness report,
 *        landing page copy, research findings and caveats, and the
 *        curriculum editor with links to each written lesson.
 * WHY:   The course query polls every 2 s while planning so the outline
 *        appears as soon as the Curriculum Architect finishes. Actions are
 *        shown only to members with the matching permission and only in the
 *        states the server accepts (re-plan before approval; approve while
 *        under review). Approval is confirmed because it locks the outline.
 * WHERE: /dashboard/courses/[courseId].
 */

import * as React from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import {
  BookOpenIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ClockIcon,
  FilmIcon,
  FileDownIcon,
  PackageIcon,
  GraduationCapIcon,
  ImageIcon,
  LayersIcon,
  Loader2Icon,
  MicIcon,
  MonitorPlayIcon,
  PlayIcon,
  RefreshCwIcon,
  SparklesIcon,
  XCircleIcon,
  type LucideIcon,
  SendIcon,
  PencilIcon,
} from 'lucide-react'

import { useOnlineStatus } from '@/hooks/use-online-status'
import { OFFLINE_ACTION_HINT } from '@/components/global/connection-status'
import { trpc } from '@/trpc/react-provider'
import { useActiveOrganization, useActiveOrganizationId } from '@/hooks/use-active-organization'
import { permissions } from '@/lib/permissions'
import { EXPORT_JOB_PACKAGES } from '@/lib/config'
import { GENERATE_COURSE_KINDS, type GenerateCourseValues } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { PageHeading } from '@/components/global/page-header'
import { ButtonGroup } from '@/components/ui/button-group'
import { LEARNER_LEVEL_GUIDES, audienceAgeRange, defaultAudienceProfile } from '@/lib/config/learner-levels'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
import { CourseStatusBadge } from '../../_components/course-status-badge'
import { AgentActivity } from './agent-activity'
import { CurriculumEditor } from './curriculum-editor'
import { PracticePanel } from './practice-panel'
import { MaterialsPanel } from './materials-panel'
import { CourseBookCard } from './course-book-card'
import { PublishDialog } from './publish-dialog'
import { EditCourseDialog } from './edit-course-dialog'
import { PublicationsCard } from './publications-card'

const LIVE_JOB = ['QUEUED', 'RUNNING'] as const

function isGenerateKind(kind: string): kind is GenerateCourseValues['kind'] {
  return GENERATE_COURSE_KINDS.some((k) => k === kind)
}
const BUILDABLE = ['CURRICULUM_REVIEW', 'REVIEW', 'FAILED', 'READY'] as const

export function CourseWorkspace({ courseId }: { courseId: string }) {
  const organizationId = useActiveOrganizationId()
  const { hasPermission } = useActiveOrganization()
  const utils = trpc.useUtils()
  const orgId = organizationId ?? ''

  const courseQuery = trpc.courses.get.useQuery(
    { organizationId: orgId, courseId },
    {
      enabled: organizationId !== undefined,
      /* Poll while agents are writing so lessons appear as each finishes. */
      refetchInterval: (query) => {
        const status = query.state.data?.status
        return status === 'RESEARCHING' || status === 'GENERATING' ? 3_000 : false
      },
    }
  )
  const generate = trpc.courses.generate.useMutation()
  /* AI steps need the internet; offline they wait, with the reason on hover. */
  const online = useOnlineStatus()
  const offlineTitle = online ? undefined : OFFLINE_ACTION_HINT
  const approve = trpc.courses.approve.useMutation()
  const [error, setError] = React.useState<string | null>(null)
  const [confirmApprove, setConfirmApprove] = React.useState(false)
  /* Publish dialog: open state and the connection to preselect (Publish again). */
  const [publishing, setPublishing] = React.useState<{ connectionId?: string } | null>(null)
  const [editingDetails, setEditingDetails] = React.useState(false)
  /* Kind of the job that just finished on this page; opens its result. */
  const [settledKind, setSettledKind] = React.useState<GenerateCourseValues['kind'] | null>(null)

  const refresh = React.useCallback(
    () => void utils.courses.get.invalidate({ organizationId: orgId, courseId }),
    [utils, orgId, courseId]
  )

  /* A finished downloads or export job lands on the Downloads tab with fresh
   * files instead of leaving the user on a tab where nothing changed. */
  const onJobSettled = React.useCallback(
    (kind: GenerateCourseValues['kind']) => {
      setSettledKind(kind)
      void utils.courses.materials.invalidate({ organizationId: orgId, courseId })
      refresh()
    },
    [utils, orgId, courseId, refresh]
  )

  async function start(kind: GenerateCourseValues['kind']) {
    setError(null)
    setSettledKind(null)
    try {
      await generate.mutateAsync({ organizationId: orgId, courseId, kind })
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start generation.')
    }
  }

  async function approveCurriculum() {
    setError(null)
    try {
      await approve.mutateAsync({ organizationId: orgId, courseId, stage: 'curriculum' })
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve the curriculum.')
    } finally {
      setConfirmApprove(false)
    }
  }

  if (!organizationId || courseQuery.isLoading) return <Skeleton className="h-64 w-full" />
  if (courseQuery.error) return <p className="text-sm text-destructive">{courseQuery.error.message}</p>
  const course = courseQuery.data
  if (!course) return null

  const approved = course.curriculumApprovedAt !== null
  const jobLive = course.latestJob !== null && LIVE_JOB.some((s) => s === course.latestJob?.status)
  const hasPlan = course.modules.length > 0
  const canGenerate = hasPermission(permissions.COURSES_GENERATE)
  const canPlan = canGenerate && !approved && !jobLive && course.status !== 'RESEARCHING'
  const canApprove =
    hasPermission(permissions.COURSES_APPROVE) && !approved && !jobLive && course.status === 'CURRICULUM_REVIEW' && hasPlan
  const editable = hasPermission(permissions.COURSES_UPDATE) && !approved && !jobLive
  const lessons = course.modules.flatMap((m) => m.lessons)
  const writtenLessons = lessons.filter((l) => l.currentVersionId !== null).length
  const canBuild = canGenerate && approved && !jobLive && BUILDABLE.some((s) => s === course.status)
  const plannedMinutes = course.modules.reduce((sum, m) => sum + m.estimatedMinutes, 0)
  /* Who the course is pitched at: level label plus ages when they apply. */
  const audienceAges = course.audienceProfile ? audienceAgeRange(course.audienceProfile) : null
  const lastJobSucceeded = course.latestJob?.status === 'SUCCEEDED'
  const canSeePublishing = hasPermission(permissions.PUBLISHING_READ) && writtenLessons > 0
  /* The school listing is shown once there is something to learn. */
  /* MODULE_SLOTS: publishing is an optional module; packages without it drop the next line. */
  let canPublish = false
  canPublish = hasPermission(permissions.PUBLISHING_CREATE) && writtenLessons > 0 && !jobLive
  /* Title, description and learner level stay editable after approval. */
  const canEditDetails = hasPermission(permissions.COURSES_UPDATE) && !jobLive
  const exportedPackage =
    lastJobSucceeded && settledKind && settledKind !== 'RESUME_BUILD' ? (EXPORT_JOB_PACKAGES[settledKind] ?? null) : null
  const openDownloads = exportedPackage !== null || (lastJobSucceeded && settledKind === 'BUILD_MATERIALS')

  /* One primary action — the next step in the course's life. */
  const primary: 'approve' | 'plan' | 'build' | 'preview' | null = canApprove
    ? 'approve'
    : canPlan && !hasPlan
      ? 'plan'
      : canBuild && writtenLessons === 0
        ? 'build'
        : writtenLessons > 0
          ? 'preview'
          : null

  /* A build that was cancelled or failed part way: offer to finish it. */
  const stoppedBuild =
    canBuild &&
    writtenLessons > 0 &&
    course.latestJob?.kind === 'BUILD_COURSE' &&
    (course.latestJob.status === 'CANCELLED' || course.latestJob.status === 'FAILED')

  /* Everything else that regenerates or renders lives in one menu. */
  const menuItems: ReadonlyArray<{
    kind: GenerateCourseValues['kind']
    label: string
    description: string
    icon: LucideIcon
  }> = [
    ...(canPlan && hasPlan
      ? [{ kind: 'PLAN_COURSE' as const, label: 'Re-plan curriculum', description: 'Draft a fresh outline', icon: RefreshCwIcon }]
      : []),
    ...(canBuild && writtenLessons > 0
      ? [
          { kind: 'RESUME_BUILD' as const, label: 'Resume build', description: 'Finish only what is missing, keep the rest', icon: PlayIcon },
          { kind: 'BUILD_COURSE' as const, label: 'Regenerate lessons', description: 'Rewrite every lesson package', icon: SparklesIcon },
          { kind: 'RENDER_VISUALS' as const, label: 'Render visuals', description: 'Redraw slides and diagrams', icon: ImageIcon },
          { kind: 'RENDER_NARRATION' as const, label: 'Generate narration', description: 'Voice every scene with your narrator', icon: MicIcon },
          { kind: 'RENDER_VIDEO' as const, label: 'Render videos', description: 'Build the lecture MP4s', icon: FilmIcon },
          { kind: 'BUILD_MATERIALS' as const, label: 'Build downloads', description: 'Workbook, cheat sheet, glossary, code and answer key', icon: FileDownIcon },
          { kind: 'EXPORT_COURSE' as const, label: 'Export course package', description: 'One ZIP to upload to Udemy or Teachable', icon: PackageIcon },
          { kind: 'EXPORT_SCORM' as const, label: 'Export SCORM package', description: 'For Moodle, TalentLMS or any LMS, with tracking', icon: GraduationCapIcon },
        ]
      : []),
  ]

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <PageHeading
          back={{ href: '/dashboard/courses', label: 'Courses' }}
          title={course.title}
          description={course.subtitle ?? undefined}
          meta={
            <>
            <CourseStatusBadge status={course.status} approved={approved} />
            {course.audienceProfile ? (
              <span className="flex items-center gap-1.5">
                <GraduationCapIcon className="size-3.5" />
                {LEARNER_LEVEL_GUIDES[course.audienceProfile.level].label}
                {audienceAges ? `, ages ${audienceAges.min} to ${audienceAges.max}` : ''}
              </span>
            ) : null}
            {hasPlan ? (
              <>
                <span className="flex items-center gap-1.5">
                  <LayersIcon className="size-3.5" /> {course.modules.length} modules
                </span>
                <span className="flex items-center gap-1.5">
                  <BookOpenIcon className="size-3.5" /> {lessons.length} lessons
                </span>
                <span className="flex items-center gap-1.5">
                  <ClockIcon className="size-3.5" />
                  {course.qualityReport ? `${course.qualityReport.estimatedVideoMinutes} min video` : `${plannedMinutes} min planned`}
                </span>
              </>
            ) : null}
            <span>Updated {formatDistanceToNow(course.updatedAt, { addSuffix: true })}</span>
            </>
          }
          actions={
            <>
          {jobLive ? (
            <span className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm text-muted-foreground">
              <Loader2Icon className="size-3.5 animate-spin" /> Agents working
            </span>
          ) : null}

          {/* Secondary actions share one joined group; the next step stands apart. */}
          {menuItems.length > 0 || canEditDetails || canPublish ? (
            <ButtonGroup>
              {menuItems.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="outline" disabled={generate.isPending || !online} title={offlineTitle} />}>
                    {generate.isPending ? <Loader2Icon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
                    Generate
                    <ChevronDownIcon className="size-4 opacity-60" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    {menuItems.map((item) => (
                      <DropdownMenuItem key={item.kind} onClick={() => void start(item.kind)} className="items-start gap-3 py-2">
                        <item.icon className="mt-0.5 size-4" />
                        <span className="space-y-0.5">
                          <span className="block text-sm font-medium">{item.label}</span>
                          <span className="block text-xs text-muted-foreground">{item.description}</span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {canPublish ? (
                <Button variant="outline" disabled={!online} title={offlineTitle} onClick={() => setPublishing({})}>
                  <SendIcon className="size-4" />
                  Publish
                </Button>
              ) : null}
              {canEditDetails ? (
                <Button variant="outline" onClick={() => setEditingDetails(true)}>
                  <PencilIcon className="size-4" />
                  Edit
                </Button>
              ) : null}
            </ButtonGroup>
          ) : null}
          {primary === 'preview' || (writtenLessons > 0 && primary !== null) ? (
            <Link
              href={`/dashboard/courses/${course.id}/learn`}
              className={buttonVariants({ variant: primary === 'preview' ? 'default' : 'outline' })}
            >
              <MonitorPlayIcon className="size-4" />
              Preview as learner
            </Link>
          ) : null}
          {primary === 'approve' ? (
            <Button onClick={() => setConfirmApprove(true)}>
              <CheckIcon className="size-4" />
              Approve curriculum
            </Button>
          ) : null}
          {primary === 'plan' ? (
            <Button disabled={generate.isPending || !online} title={offlineTitle} onClick={() => void start('PLAN_COURSE')}>
              {generate.isPending ? <Loader2Icon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
              Plan curriculum
            </Button>
          ) : null}
          {stoppedBuild ? (
            <Button disabled={generate.isPending || !online} title={offlineTitle} onClick={() => void start('RESUME_BUILD')}>
              {generate.isPending ? <Loader2Icon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}
              Resume build
            </Button>
          ) : null}
          {primary === 'build' ? (
            <Button disabled={generate.isPending || !online} title={offlineTitle} onClick={() => void start('BUILD_COURSE')}>
              {generate.isPending ? <Loader2Icon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
              Generate lessons
            </Button>
          ) : null}
            </>
          }
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>

      {/* Header stays above the tabs; each concern gets its own tab
          (blueprint §29). Opens on Activity while agents are working. */}
      <Tabs
        key={jobLive ? 'live' : `idle-${openDownloads}`}
        defaultValue={jobLive ? 'activity' : openDownloads ? 'downloads' : hasPlan ? 'curriculum' : 'overview'}
      >
        <TabsList className="w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] sm:w-fit [&::-webkit-scrollbar]:hidden">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="curriculum">Curriculum{lessons.length > 0 ? ` (${lessons.length})` : ''}</TabsTrigger>
          <TabsTrigger value="activity">
            Activity
            {jobLive ? <Loader2Icon className="size-3.5 animate-spin" /> : null}
          </TabsTrigger>
          {writtenLessons > 0 ? <TabsTrigger value="practice">Practice</TabsTrigger> : null}
          {writtenLessons > 0 ? <TabsTrigger value="downloads">Downloads</TabsTrigger> : null}
          {course.subtitle ? <TabsTrigger value="landing">Landing page</TabsTrigger> : null}
          {course.research ? <TabsTrigger value="research">Research</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="overview" className="space-y-6 pt-4">
          <CourseBookCard
            organizationId={orgId}
            courseId={course.id}
            editable={editable}
            canPlan={canPlan}
            onPlan={() => start('PLAN_COURSE')}
            onChanged={refresh}
          />
          {canSeePublishing ? (
            <PublicationsCard
              organizationId={orgId}
              courseId={course.id}
              canPublish={canPublish}
              onPublish={(connectionId) => setPublishing(connectionId ? { connectionId } : {})}
            />
          ) : null}
          {approved ? (
            <Card>
              <CardHeader>
                <CardTitle>Lesson packages</CardTitle>
                <CardDescription>
                  {writtenLessons} of {lessons.length} lessons written.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}
          {course.qualityReport ? (
            <Card>
              <CardHeader>
                <CardTitle>Course readiness</CardTitle>
                <CardDescription>
                  {course.qualityReport.lectures} lectures · ≈{course.qualityReport.estimatedVideoMinutes} min of video ·{' '}
                  {course.qualityReport.checks.filter((c) => c.passed).length} of {course.qualityReport.checks.length} checks
                  passed
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {course.qualityReport.checks.map((check) => (
                    <li key={check.id} className="flex items-start gap-2 text-sm">
                      {check.passed ? (
                        <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" />
                      ) : (
                        <XCircleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
                      )}
                      <span>
                        {check.label} <span className="text-muted-foreground">· {check.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
          {!approved && !course.qualityReport ? (
            <Card>
              <CardHeader>
                <CardTitle>{hasPlan ? 'Review the curriculum' : 'Ready to plan'}</CardTitle>
                <CardDescription>
                  {hasPlan
                    ? 'Edit the outline, then approve it.'
                    : 'Plan the course to draft a curriculum.'}
                </CardDescription>
              </CardHeader>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="curriculum" className="pt-4">
          {hasPlan ? (
            <CurriculumEditor organizationId={orgId} course={course} editable={editable} />
          ) : (
            <p className="text-sm text-muted-foreground">No curriculum yet. Plan the course to create one.</p>
          )}
        </TabsContent>

        <TabsContent value="activity" className="pt-4">
          {course.latestJob ? (
            <AgentActivity
              organizationId={orgId}
              jobId={course.latestJob.id}
              onSettled={() => course.latestJob && isGenerateKind(course.latestJob.kind) ? onJobSettled(course.latestJob.kind) : refresh()}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Ready to plan</CardTitle>
                <CardDescription>
                  The Research Agent studies your topic, then the Curriculum Architect drafts modules and lessons for you
                  to review.
                </CardDescription>
              </CardHeader>
            </Card>
          )}
        </TabsContent>

        {writtenLessons > 0 ? (
          <TabsContent value="practice" className="pt-4">
            <PracticePanel organizationId={orgId} courseId={course.id} />
          </TabsContent>
        ) : null}

        {writtenLessons > 0 ? (
          <TabsContent value="downloads" className="pt-4">
            <MaterialsPanel
              organizationId={orgId}
              courseId={course.id}
              autoDownload={exportedPackage}
            />
          </TabsContent>
        ) : null}

        {course.subtitle ? (
          <TabsContent value="landing" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Landing page</CardTitle>
                <CardDescription>{course.subtitle}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {course.description ? <p className="whitespace-pre-line text-muted-foreground">{course.description}</p> : null}
                {course.whatYouWillLearn.length > 0 ? (
                  <div className="space-y-1">
                    <p className="font-medium">What you’ll learn</p>
                    <ul className="grid gap-1 sm:grid-cols-2">
                      {course.whatYouWillLearn.map((item) => (
                        <li key={item}>✓ {item}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-6">
                  {course.requirements.length > 0 ? (
                    <div className="space-y-1">
                      <p className="font-medium">Requirements</p>
                      <ul className="list-disc pl-5 text-muted-foreground">
                        {course.requirements.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {course.targetAudience.length > 0 ? (
                    <div className="space-y-1">
                      <p className="font-medium">Who this course is for</p>
                      <ul className="list-disc pl-5 text-muted-foreground">
                        {course.targetAudience.map((a) => (
                          <li key={a}>{a}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline">{lessons.length} lectures</Badge>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}

        {course.research ? (
          <TabsContent value="research" className="pt-4">
            <Card>
              <CardHeader>
                <CardTitle>Research findings</CardTitle>
                <CardDescription>
                  Version {course.research.version} · {course.research.keyConceptCount} key concepts
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{course.research.summary}</p>
                {course.research.caveats.length > 0 ? (
                  <div className="space-y-1">
                    <p className="font-medium">Check before publishing</p>
                    <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                      {course.research.caveats.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </TabsContent>
        ) : null}
      </Tabs>






      <EditCourseDialog
        organizationId={orgId}
        courseId={course.id}
        open={editingDetails}
        onOpenChange={setEditingDetails}
        initial={{
          title: course.title,
          subtitle: course.subtitle ?? '',
          description: course.description ?? '',
          audienceProfile: course.audienceProfile ?? defaultAudienceProfile(),
        }}
      />
      <PublishDialog
        key={publishing?.connectionId ?? 'new'}
        organizationId={orgId}
        courseId={course.id}
        courseTitle={course.title}
        open={publishing !== null}
        onOpenChange={(open) => (open ? null : setPublishing(null))}
        connectionId={publishing?.connectionId}
        onStarted={refresh}
      />

      <AlertDialog open={confirmApprove} onOpenChange={setConfirmApprove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve this curriculum?</AlertDialogTitle>
            <AlertDialogDescription>
              The outline will be locked and lesson generation starts right away: notes, a narrated video script,
              exercises, and a quiz for every lesson.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => void approveCurriculum()}>Approve</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
