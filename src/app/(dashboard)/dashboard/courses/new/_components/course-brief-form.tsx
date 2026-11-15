'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: CourseBriefForm, new course form, courseBriefSchema,
 *   createCourseSchema, start planning, course brief wizard
 *
 * WHAT:  Collects the course brief (blueprint §27) and starts planning:
 *        courses.create → courses.generate(PLAN_COURSE) → course workspace.
 *        Left: the brief in four titled sections. Right (sticky): a live
 *        estimate of what will be produced and how the process works.
 * WHY:   One submit does both steps so the user lands on a page already
 *        showing the agents at work. If planning can't start (e.g. no model
 *        routed), the course is still created and the workspace explains why.
 *        The learner level (Toddlers to PhD, AudienceProfileFields) comes
 *        first and is required: every agent adapts to it. Level and length
 *        are buttons, not dropdowns, because they shape the course most.
 *        Teaching style suggestions follow the chosen level. The side panel
 *        estimates lecture count from length and the level's usual lecture
 *        length, and states the approval checkpoint, so nothing about cost
 *        or control is a surprise. Validated with the router's own schema.
 *        Courses built from a book use BookCourseForm instead.
 * WHERE: /dashboard/courses/new.
 */

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  BookOpenIcon,
  CheckIcon,
  DumbbellIcon,
  FileTextIcon,
  LayoutTemplateIcon,
  ListChecksIcon,
  Loader2Icon,
  NetworkIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TrophyIcon,
  UsersIcon,
  VideoIcon,
  type LucideIcon,
} from 'lucide-react'

import { useOnlineStatus } from '@/hooks/use-online-status'
import { OFFLINE_ACTION_HINT } from '@/components/global/connection-status'
import { trpc } from '@/trpc/react-provider'
import { useActiveOrganizationId } from '@/hooks/use-active-organization'
import { cn } from '@/lib/utils'
import {
  COURSE_DIFFICULTIES,
  SOURCE_MATERIAL_MAX,
  createCourseSchema,
  type AudienceProfile,
  type CourseDifficulty,
  type CreateCourseValues,
} from '@/lib/types'
import { defaultAudienceProfile, learnerLevelGuide } from '@/lib/config/learner-levels'
import { AudienceProfileFields, TeachingStyleSuggestions } from '@/components/global/audience-profile'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

const DURATION_OPTIONS = [30, 60, 90, 120, 180, 240, 360, 480, 600] as const

function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = minutes / 60
  return `${hours} hr${hours === 1 ? '' : 's'}`
}

const LEVELS: Record<CourseDifficulty, { label: string; description: string }> = {
  beginner: { label: 'Beginner', description: 'No prior knowledge of the topic' },
  intermediate: { label: 'Intermediate', description: 'Knows the basics, wants depth' },
  advanced: { label: 'Advanced', description: 'Experienced, wants mastery' },
}

const INCLUDE_OPTIONS: ReadonlyArray<{
  key: 'exercises' | 'quizzes' | 'projects'
  label: string
  description: string
  icon: LucideIcon
}> = [
  { key: 'exercises', label: 'Exercises', description: 'Practice after every lesson', icon: DumbbellIcon },
  { key: 'quizzes', label: 'Quizzes', description: 'Questions tied to outcomes', icon: ListChecksIcon },
  { key: 'projects', label: 'Final project', description: 'A hands-on capstone', icon: TrophyIcon },
]

const PROCESS_STEPS = [
  { title: 'Research', description: 'Agents study the topic and your source material.' },
  { title: 'Curriculum', description: 'Outcomes, modules and lessons for you to approve.' },
  { title: 'Lesson packages', description: 'Notes, narrated video scripts, visuals, exercises and quizzes.' },
  { title: 'Preview', description: 'Watch the course as a learner before publishing.' },
] as const

function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <Icon className="size-4" />
          </span>
          <div className="space-y-0.5">
            <CardTitle className="text-base">{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">{children}</CardContent>
    </Card>
  )
}

export function CourseBriefForm() {
  const router = useRouter()
  const organizationId = useActiveOrganizationId()
  const create = trpc.courses.create.useMutation()
  const online = useOnlineStatus()
  const generate = trpc.courses.generate.useMutation()
  const [error, setError] = React.useState<string | null>(null)
  const [showSource, setShowSource] = React.useState(false)

  const form = useForm<CreateCourseValues>({
    resolver: zodResolver(createCourseSchema),
    defaultValues: {
      organizationId: organizationId ?? '',
      brief: {
        topic: '',
        description: '',
        audience: '',
        audienceProfile: defaultAudienceProfile(),
        difficulty: 'beginner',
        language: 'English',
        teachingStyle: learnerLevelGuide(defaultAudienceProfile().level).teachingStyles[0] ?? '',
        targetDurationMinutes: 120,
        includes: { exercises: true, quizzes: true, projects: true },
        sourceMaterial: '',
      },
    },
  })

  React.useEffect(() => {
    if (organizationId) form.setValue('organizationId', organizationId)
  }, [organizationId, form])

  const brief = useWatch({ control: form.control, name: 'brief' })
  const levelGuide = learnerLevelGuide(brief.audienceProfile.level)
  const lectures = Math.max(3, Math.round(brief.targetDurationMinutes / levelGuide.lectureMinutes.typical))

  /* A suggested teaching style follows the level; a typed one is kept. */
  function changeAudience(next: AudienceProfile, apply: (value: AudienceProfile) => void) {
    const previous = learnerLevelGuide(form.getValues('brief.audienceProfile.level')).teachingStyles
    const style = form.getValues('brief.teachingStyle')
    if (style === '' || previous.includes(style)) {
      form.setValue('brief.teachingStyle', learnerLevelGuide(next.level).teachingStyles[0] ?? '')
    }
    apply(next)
  }
  const modules = Math.max(2, Math.min(8, Math.round(lectures / 4)))

  async function onSubmit(values: CreateCourseValues) {
    setError(null)
    let courseId: string
    try {
      courseId = (await create.mutateAsync(values)).id
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the course.')
      return
    }
    try {
      await generate.mutateAsync({ organizationId: values.organizationId, courseId, kind: 'PLAN_COURSE' })
    } catch {
      /* The workspace shows why planning couldn't start and offers a retry. */
    }
    router.push(`/dashboard/courses/${courseId}`)
  }

  const pending = create.isPending || generate.isPending

  const outputs: ReadonlyArray<{ icon: LucideIcon; label: string; on: boolean }> = [
    { icon: VideoIcon, label: 'Narrated video lessons', on: true },
    { icon: NetworkIcon, label: 'Diagrams and code demos', on: true },
    { icon: FileTextIcon, label: 'Lesson notes', on: true },
    { icon: DumbbellIcon, label: 'Exercises with solutions', on: brief.includes.exercises },
    { icon: ListChecksIcon, label: 'Quizzes with explanations', on: brief.includes.quizzes },
    { icon: TrophyIcon, label: 'Final project', on: brief.includes.projects },
    { icon: LayoutTemplateIcon, label: 'Course landing page', on: true },
  ]

  return (
    <div className="space-y-8">

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0 space-y-6">
            <SectionCard icon={BookOpenIcon} title="What are you teaching?" description="The topic and what the course should cover.">
              <FormField
                control={form.control}
                name="brief.topic"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Course topic</FormLabel>
                    <FormControl>
                      <Input className="h-11 text-base" placeholder="e.g. React Hooks for beginners" autoFocus {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="brief.description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        rows={4}
                        placeholder="Goals, topics to cover or avoid, examples to use"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>Optional. More detail gives a better curriculum.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SectionCard>

            <SectionCard icon={UsersIcon} title="Who is it for?" description="Lessons, videos, pictures and quizzes adapt to your learners.">
              <FormField
                control={form.control}
                name="brief.audienceProfile"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Learner level</FormLabel>
                    <AudienceProfileFields value={field.value} onChange={(next) => changeAudience(next, field.onChange)} />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="brief.audience"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Audience</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. Year 5 pupils who enjoy science" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="brief.difficulty"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Experience with this topic</FormLabel>
                    <div role="radiogroup" aria-label="Experience with this topic" className="grid gap-2 sm:grid-cols-3">
                      {COURSE_DIFFICULTIES.map((level) => {
                        const selected = field.value === level
                        return (
                          <button
                            key={level}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => field.onChange(level)}
                            className={cn(
                              'rounded-lg border p-3 text-left transition-colors',
                              selected ? 'border-foreground bg-muted' : 'hover:bg-muted/50'
                            )}
                          >
                            <span className="flex items-center justify-between text-sm font-medium">
                              {LEVELS[level].label}
                              {selected ? <CheckIcon className="size-4" /> : null}
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">{LEVELS[level].description}</span>
                          </button>
                        )
                      })}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="brief.language"
                render={({ field }) => (
                  <FormItem className="max-w-xs">
                    <FormLabel>Language</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormDescription>Used for lessons, narration and quizzes.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </SectionCard>

            <SectionCard icon={LayoutTemplateIcon} title="Course format" description="Length, teaching style and what to include.">
              <FormField
                control={form.control}
                name="brief.targetDurationMinutes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Total length</FormLabel>
                    <div role="radiogroup" aria-label="Total length" className="flex flex-wrap gap-2">
                      {DURATION_OPTIONS.map((minutes) => {
                        const selected = field.value === minutes
                        return (
                          <button
                            key={minutes}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => field.onChange(minutes)}
                            className={cn(
                              'rounded-full border px-3.5 py-1.5 text-sm transition-colors',
                              selected ? 'border-foreground bg-foreground text-background' : 'hover:bg-muted/50'
                            )}
                          >
                            {durationLabel(minutes)}
                          </button>
                        )
                      })}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="brief.teachingStyle"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Teaching style</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <TeachingStyleSuggestions suggestions={levelGuide.teachingStyles} value={field.value} onChange={field.onChange} />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormItem>
                <FormLabel>Include</FormLabel>
                <div className="grid gap-2 sm:grid-cols-3">
                  {INCLUDE_OPTIONS.map((option) => (
                    <FormField
                      key={option.key}
                      control={form.control}
                      name={`brief.includes.${option.key}`}
                      render={({ field }) => (
                        <label
                          className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                            field.value ? 'border-foreground bg-muted' : 'hover:bg-muted/50'
                          )}
                        >
                          <option.icon className="mt-0.5 size-4 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{option.label}</span>
                            <span className="block text-xs text-muted-foreground">{option.description}</span>
                          </span>
                          <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked)} />
                        </label>
                      )}
                    />
                  ))}
                </div>
              </FormItem>
            </SectionCard>

            <SectionCard
              icon={FileTextIcon}
              title="Source material"
              description="Optional notes or docs the agents treat as fact."
            >
              {showSource ? (
                <FormField
                  control={form.control}
                  name="brief.sourceMaterial"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Textarea rows={8} placeholder="Paste your material here…" {...field} />
                      </FormControl>
                      <FormDescription className="flex justify-between gap-2">
                        <span>Facts here take priority over the model’s own knowledge.</span>
                        <span className="tabular-nums">
                          {field.value.length.toLocaleString()} / {SOURCE_MATERIAL_MAX.toLocaleString()}
                        </span>
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <Button type="button" variant="outline" className="w-fit" onClick={() => setShowSource(true)}>
                  Add source material
                </Button>
              )}
            </SectionCard>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex flex-wrap items-center gap-3 border-t pt-6">
              <Button type="submit" size="lg" disabled={pending || !organizationId || !online} title={online ? undefined : OFFLINE_ACTION_HINT}>
                {pending ? <Loader2Icon className="size-4 animate-spin" /> : <SparklesIcon className="size-4" />}
                Create course & plan curriculum
              </Button>
              <Link href="/dashboard/courses" className={buttonVariants({ variant: 'ghost', size: 'lg' })}>
                Cancel
              </Link>
            </div>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="text-base">What you’ll get</CardTitle>
                <CardDescription>Estimated from your choices.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 pt-5">
                <dl className="grid grid-cols-3 gap-2 text-center">
                  {[
                    { label: 'Length', value: durationLabel(brief.targetDurationMinutes) },
                    { label: 'Lectures', value: `≈${lectures}` },
                    { label: 'Modules', value: `≈${modules}` },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-lg bg-muted/50 px-2 py-2.5">
                      <dd className="text-lg font-semibold tabular-nums">{stat.value}</dd>
                      <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                    </div>
                  ))}
                </dl>
                <ul className="space-y-2">
                  {outputs.map((output) => (
                    <li
                      key={output.label}
                      className={cn('flex items-center gap-2.5 text-sm', !output.on && 'text-muted-foreground line-through')}
                    >
                      <output.icon className="size-4 shrink-0" />
                      {output.label}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b">
                <CardTitle className="text-base">How it works</CardTitle>
              </CardHeader>
              <CardContent className="pt-5">
                <ol className="space-y-4">
                  {PROCESS_STEPS.map((step, i) => (
                    <li key={step.title} className="flex gap-3">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold">
                        {i + 1}
                      </span>
                      <span className="space-y-0.5">
                        <span className="block text-sm font-medium">{step.title}</span>
                        <span className="block text-xs text-muted-foreground">{step.description}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-5 flex items-start gap-2 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                  <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" />
                  Only research and planning run now. Lessons, videos and visuals start after you approve the curriculum.
                </p>
              </CardContent>
            </Card>
          </aside>
        </form>
      </Form>
    </div>
  )
}
