'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: SetupStepsCard, getting started, onboarding
 *   checklist, connect a model, add a voice, first course
 *
 * WHAT:  The getting-started checklist on the dashboard: connect a writing
 *        model, add a narration voice, create a course, finish a course.
 *        Hidden once every step is done.
 * WHY:   A new workspace cannot generate anything until a model is routed;
 *        showing the next step with a direct link removes the guesswork.
 * WHERE: DashboardHome.
 */

import Link from 'next/link'
import type { Route } from 'next'
import { ArrowRightIcon, CheckIcon } from 'lucide-react'

import { trpc } from '@/trpc/react-provider'
import { cn } from '@/lib/utils'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function SetupStepsCard({ organizationId }: { organizationId: string }) {
  const setup = trpc.dashboard.setup.useQuery({ organizationId })
  const data = setup.data
  if (!data) return null

  const steps: ReadonlyArray<{ done: boolean; title: string; description: string; href: Route }> = [
    { done: data.textModel, title: 'Connect a writing model', description: 'Route Strong reasoning to a model in AI providers.', href: '/dashboard/settings/ai-providers' },
    { done: data.voiceModel, title: 'Add a narration voice', description: 'Route Text to speech so lectures are narrated.', href: '/dashboard/settings/ai-providers' },
    { done: data.hasCourse, title: 'Create your first course', description: 'Describe a topic or upload a course book.', href: '/dashboard/courses/new' },
    { done: data.hasFinishedCourse, title: 'Finish a course', description: 'Approve the curriculum and let the agents build it.', href: '/dashboard/courses' },
  ]
  const done = steps.filter((step) => step.done).length
  if (done === steps.length) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get started</CardTitle>
        <CardDescription>
          {done} of {steps.length} steps done.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <Link
            key={step.title}
            href={step.href}
            className={cn(
              'group flex flex-col gap-2 rounded-lg border p-3 transition-colors hover:bg-muted/50',
              step.done && 'opacity-60'
            )}
          >
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full border text-xs',
                step.done && 'border-transparent bg-primary text-primary-foreground'
              )}
            >
              {step.done ? <CheckIcon className="size-3.5" /> : steps.indexOf(step) + 1}
            </span>
            <span className="text-sm font-medium">{step.title}</span>
            <span className="text-xs text-muted-foreground">{step.description}</span>
            {!step.done ? (
              <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium">
                Open <ArrowRightIcon className="size-3 transition-transform group-hover:translate-x-0.5" />
              </span>
            ) : null}
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}
