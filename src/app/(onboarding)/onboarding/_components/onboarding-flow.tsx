/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: OnboardingFlow
 *
 * WHAT:  Client onboarding wizard — name the organization → pick a plan →
 *        (paid) enter a card. Free finishes immediately; paid creates the org
 *        then attaches a subscription via the custom Elements flow.
 * WHY:   The org is always created locally first (free tier), so there's no
 *        dependency on the webhook to provision it; a paid plan then calls
 *        billing.createSubscription and the webhook upgrades the tier. RHF +
 *        zod on the name input per CLAUDE.md.
 *        Users who already belong to an organization (here from the
 *        switcher's "Create organization") get a way back to the dashboard
 *        and copy for an additional workspace; users with none get no exit,
 *        since a workspace is required to use the app.
 * WHERE: Rendered by the onboarding page. Talks to
 *        trpc.organization.createOrganization, trpc.billing.createSubscription,
 *        and authClient.organization.setActive.
 */

import * as React from 'react'
import Link from 'next/link'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { ArrowLeftIcon, Loader2Icon } from 'lucide-react'

import { trpc } from '@/trpc/react-provider'
import { setActiveOrganization } from '@/lib/adapters/actions.client'
import { ROUTES, SUBSCRIPTIONS_ENABLED, isPaidPlan, PLANS, type PlanKey, type BillingInterval } from '@/lib/config'
import {
  organizationNameFormSchema,
  type CreateOrganizationValues,
  type OrganizationNameFormValues,
} from '@/lib/types'
import { AppFrame, AppFrameSteps } from '@/components/global/app-frame'
import { Button, buttonVariants } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

type Step = 'details' | 'access' | 'plan' | 'payment'
interface CreatedOrg {
  organizationId: string
  slug: string
}

export function OnboardingFlow() {
  const [step, setStep] = React.useState<Step>('details')
  const [name, setName] = React.useState('')
  const [selectedPlan, setSelectedPlan] = React.useState<PlanKey>('free')
  const [interval, setInterval] = React.useState<BillingInterval>('monthly')
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const createOrganization = trpc.organization.createOrganization.useMutation()
  /* Already in a workspace: this is an additional one, so leaving is allowed. */
  const { data: organizations } = trpc.organization.getUserOrganizations.useQuery(undefined, { staleTime: 5 * 60 * 1000 })
  const hasOrganization = (organizations?.length ?? 0) > 0

  const form = useForm<OrganizationNameFormValues>({
    resolver: zodResolver(organizationNameFormSchema),
    defaultValues: { name: '' },
    mode: 'onTouched',
  })

  /* MODULE_SLOTS: the Student access step belongs to the school module;
   * packages without it go from the name straight to the plan. */
  const STEP_ORDER: Step[] = ['details', 'plan', 'payment']
  const STEP_LABELS: string[] = ['Name your workspace', 'Choose a plan', 'Payment']
  const hasAccessStep = STEP_ORDER.includes('access')
  /* Fields the workspace is created with besides its name. */
  let createExtras: Omit<CreateOrganizationValues, 'name' | 'logo'> = {}
  const stepNumber = STEP_ORDER.indexOf(step) + 1
  const totalSteps = !SUBSCRIPTIONS_ENABLED ? STEP_ORDER.indexOf('plan') : isPaidPlan(selectedPlan) ? STEP_ORDER.length : STEP_ORDER.length - 1


  async function finish(org: CreatedOrg) {
    await setActiveOrganization({
      organizationId: org.organizationId,
      organizationSlug: org.slug,
    })
    window.location.assign(ROUTES.dashboard)
  }

  function onDetailsSubmit(values: OrganizationNameFormValues) {
    setName(values.name)
    setError(null)
    if (hasAccessStep) setStep('access')
    else void afterSetup(values.name, createExtras)
  }


  /* After the setup steps: the plan step, or (subscriptions off) create the workspace now. */
  async function afterSetup(orgName: string, extras: Omit<CreateOrganizationValues, 'name' | 'logo'>) {
    setError(null)
    if (SUBSCRIPTIONS_ENABLED) {
      setStep('plan')
      return
    }
    setBusy(true)
    try {
      await finish(await createOrganization.mutateAsync({ name: orgName, ...extras }))
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Could not create your organization.')
    }
  }


  return (
    <AppFrame
      homeHref={hasOrganization ? ROUTES.dashboard : '/'}
      width={step === 'plan' ? 'lg' : step === 'access' ? 'md' : 'sm'}
      stepper={<AppFrameSteps steps={STEP_LABELS.slice(0, totalSteps)} current={stepNumber - 1} />}
      actions={
        hasOrganization ? (
          <Link
            href={ROUTES.dashboard}
            className={buttonVariants({
              variant: 'ghost',
              size: 'sm',
            })}
          >
            <ArrowLeftIcon className="size-4" />
            Back to dashboard
          </Link>
        ) : null
      }
    >
      <div>

        {step === 'details' ? (
          <div className="space-y-6">
            <StepHeading
              title={hasOrganization ? 'Create another organization' : 'Create your organization'}
              description={
                hasOrganization
                  ? 'A separate workspace with its own courses, team and plan.'
                  : 'This is your workspace. You can rename it or invite teammates later.'
              }
            />
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onDetailsSubmit)} className="space-y-6" noValidate>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Organization name</FormLabel>
                      <FormControl>
                        <Input type="text" autoComplete="organization" placeholder="Acme Inc." {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
                <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:justify-center">
                  {hasOrganization ? (
                    <Link href={ROUTES.dashboard} className={buttonVariants({ variant: 'outline', className: 'w-full sm:w-auto' })}>
                      Cancel
                    </Link>
                  ) : null}
                  <Button type="submit" className="w-full sm:w-auto" disabled={busy}>
                    {hasAccessStep || SUBSCRIPTIONS_ENABLED ? 'Continue' : 'Create workspace'}
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        ) : null}


      </div>
    </AppFrame>
  )
}

/* Centred step title, matching the centred stepper and buttons. */
function StepHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-2 text-center">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}
