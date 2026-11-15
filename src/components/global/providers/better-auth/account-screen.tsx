'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: BetterAuthAccountScreen, account settings, profile
 *   form, change password, active sessions, sign out other devices,
 *   AccountProfileSection, AccountPasswordSection, AccountSessionsSection
 *
 * WHAT:  The signed-in person's own account page: profile (display name, read
 *        only email), password change, and the devices signed in to the
 *        account with per-device and "all other devices" sign out.
 * WHY:   The user menu's "Account" link used to land on Billing, which says
 *        nothing about the person. Everything here is about the user, not the
 *        organization, so it calls Better Auth directly (like the auth forms)
 *        and needs no organization permission. Each section is its own
 *        component so a provider swap replaces this one file.
 * WHERE: ActiveAccountScreen (active.better-auth.tsx) → AccountScreen
 *        (providers/server.tsx) → /dashboard/settings/account.
 */

import * as React from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { Loader2Icon, MonitorIcon } from 'lucide-react'

import { authClient } from '@/lib/better-auth/auth-client'
import { trpc } from '@/trpc/react-provider'
import {
  AUTH_PASSWORD_MIN_LENGTH,
  changePasswordSchema,
  updateProfileSchema,
  type ChangePasswordValues,
  type UpdateProfileValues,
} from '@/lib/types'
import { describeUserAgent, displayIpAddress } from '@/lib/utils'
import { SettingsSection } from '@/components/global/settings-section'
import { UserIdentity } from '@/components/global/user-identity'
import { PasswordInput } from '@/components/global/password-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

export function BetterAuthAccountScreen() {
  return (
    <div className="space-y-10">
      <AccountProfileSection />
      <AccountPasswordSection />
      <AccountSessionsSection />
    </div>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: AccountProfileSection, updateUser, display name
 * WHAT:  Edits the display name; shows the email read only.
 * WHY:   Refreshes user.getProfile afterwards so the sidebar user menu and the
 *        team list show the new name without a reload.
 * WHERE: BetterAuthAccountScreen.
 */
function AccountProfileSection() {
  const utils = trpc.useUtils()
  const { data: user, isLoading } = trpc.user.getProfile.useQuery(undefined, { staleTime: 5 * 60 * 1000 })
  const [status, setStatus] = React.useState<{ kind: 'saved' | 'error'; message: string } | null>(null)

  const form = useForm<UpdateProfileValues>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: { name: '' },
  })

  React.useEffect(() => {
    if (user) form.reset({ name: user.name })
  }, [user, form])

  async function onSubmit(values: UpdateProfileValues) {
    setStatus(null)
    const { error } = await authClient.updateUser({ name: values.name })
    if (error) {
      setStatus({ kind: 'error', message: error.message ?? 'Could not save your name.' })
      return
    }
    await utils.user.getProfile.invalidate()
    form.reset(values)
    setStatus({ kind: 'saved', message: 'Saved.' })
  }

  return (
    <SettingsSection
      title="Profile"
      description="Your name and the email you sign in with"
      label="Your details"
      labelDescription="How you appear to your team"
    >
      {isLoading || !user ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="space-y-6">
          <UserIdentity name={user.name || user.email} email={user.email} image={user.image} size="lg" />
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Name</FormLabel>
                    <FormControl>
                      <Input autoComplete="name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="space-y-2">
                <Label htmlFor="account-email">Email</Label>
                <Input id="account-email" value={user.email} disabled readOnly />
                <p className="text-sm text-muted-foreground">Your sign in email cannot be changed here.</p>
              </div>
              {status ? (
                <p className={status.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
                  {status.message}
                </p>
              ) : null}
              <Button type="submit" className="w-fit" disabled={form.formState.isSubmitting || !form.formState.isDirty}>
                {form.formState.isSubmitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
                Save changes
              </Button>
            </form>
          </Form>
        </div>
      )}
    </SettingsSection>
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: AccountPasswordSection, changePassword,
 *   revokeOtherSessions, password change form
 * WHAT:  Changes the password after checking the current one, optionally
 *        signing out every other device.
 * WHY:   Signing out other devices is on by default: the usual reason to
 *        change a password is suspecting someone else has it.
 * WHERE: BetterAuthAccountScreen.
 */
function AccountPasswordSection() {
  const queryClient = useQueryClient()
  const [status, setStatus] = React.useState<{ kind: 'saved' | 'error'; message: string } | null>(null)
  const emptyValues: ChangePasswordValues = {
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    revokeOtherSessions: true,
  }
  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: emptyValues,
  })

  async function onSubmit(values: ChangePasswordValues) {
    setStatus(null)
    const { error } = await authClient.changePassword({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
      revokeOtherSessions: values.revokeOtherSessions,
    })
    if (error) {
      setStatus({ kind: 'error', message: error.message ?? 'Could not change your password.' })
      return
    }
    form.reset(emptyValues)
    await queryClient.invalidateQueries({ queryKey: ACCOUNT_SESSIONS_KEY })
    setStatus({
      kind: 'saved',
      message: values.revokeOtherSessions ? 'Password changed. Other devices were signed out.' : 'Password changed.',
    })
  }

  return (
    <SettingsSection
      title="Password"
      description="Change the password you sign in with"
      label="Change password"
      labelDescription={`Use at least ${AUTH_PASSWORD_MIN_LENGTH} characters`}
    >
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
          <FormField
            control={form.control}
            name="currentPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Current password</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="current-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>New password</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirm new password</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="revokeOtherSessions"
            render={({ field }) => (
              <FormItem className="flex flex-row items-start gap-3">
                <FormControl>
                  <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                </FormControl>
                <div className="space-y-1">
                  <FormLabel className="font-normal">Sign out of all other devices</FormLabel>
                  <FormDescription>Recommended if you think someone else knows your password.</FormDescription>
                </div>
              </FormItem>
            )}
          />
          {status ? (
            <p className={status.kind === 'error' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>
              {status.message}
            </p>
          ) : null}
          <Button type="submit" className="w-fit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? <Loader2Icon className="size-4 animate-spin" /> : null}
            Change password
          </Button>
        </form>
      </Form>
    </SettingsSection>
  )
}

/* Shared so a password change (which can sign out other devices) refreshes the list. */
const ACCOUNT_SESSIONS_KEY = ['account', 'sessions'] as const
/* Rows shown before "Show all"; long-lived accounts collect many sessions. */
const SESSIONS_PREVIEW_COUNT = 5

/**
 * SOURCE OF TRUTH KEYWORDS: AccountSessionsSection, listSessions,
 *   revokeSession, revokeOtherSessions, signed in devices
 * WHAT:  Every device signed in to this account, newest activity first, with
 *        "This device" marked and sign out for the others.
 * WHY:   Lets someone end a session on a lost or shared computer without
 *        changing their password.
 * WHERE: BetterAuthAccountScreen.
 */
function AccountSessionsSection() {
  const queryClient = useQueryClient()
  const [pending, setPending] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [showAll, setShowAll] = React.useState(false)

  const sessions = useQuery({
    queryKey: ACCOUNT_SESSIONS_KEY,
    queryFn: async () => {
      const [list, current] = await Promise.all([authClient.listSessions(), authClient.getSession()])
      if (list.error) throw new Error(list.error.message ?? 'Could not load your devices.')
      return {
        currentToken: current.data?.session.token ?? null,
        items: [...list.data].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      }
    },
  })

  const currentToken = sessions.data?.currentToken ?? null
  const items = sessions.data?.items ?? []
  const others = items.filter((session) => session.token !== currentToken)
  /* This device first, then the most recently active. */
  const ordered = [...items.filter((session) => session.token === currentToken), ...others]
  const visible = showAll ? ordered : ordered.slice(0, SESSIONS_PREVIEW_COUNT)
  const hiddenCount = ordered.length - visible.length

  async function run(key: string, action: () => Promise<{ error: { message?: string | undefined } | null }>) {
    setError(null)
    setPending(key)
    const { error: actionError } = await action()
    setPending(null)
    if (actionError) setError(actionError.message ?? 'Could not sign out that device.')
    await queryClient.invalidateQueries({ queryKey: ACCOUNT_SESSIONS_KEY })
  }

  return (
    <SettingsSection
      title="Sessions"
      description="Devices signed in to your account"
      label="Signed in devices"
      labelDescription="Sign out any device you do not recognise"
    >
      {sessions.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : sessions.error ? (
        <p className="text-sm text-destructive">{sessions.error.message}</p>
      ) : (
        <div className="space-y-4">
          <ul className="divide-y rounded-lg border bg-card">
            {visible.map((session) => {
              const isCurrent = session.token === currentToken
              return (
                <li key={session.id} className="flex items-center gap-3 p-3">
                  <MonitorIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium">
                      {describeUserAgent(session.userAgent)}
                      {isCurrent ? <Badge variant="secondary">This device</Badge> : null}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {displayIpAddress(session.ipAddress) ? `${displayIpAddress(session.ipAddress)} · ` : ''}
                      Active {formatDistanceToNow(new Date(session.updatedAt), { addSuffix: true })}
                    </p>
                  </div>
                  {isCurrent ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending !== null}
                      onClick={() => run(session.id, () => authClient.revokeSession({ token: session.token }))}
                    >
                      {pending === session.id ? <Loader2Icon className="size-4 animate-spin" /> : null}
                      Sign out
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
          {hiddenCount > 0 || (showAll && ordered.length > SESSIONS_PREVIEW_COUNT) ? (
            <Button variant="ghost" size="sm" className="w-fit" onClick={() => setShowAll((value) => !value)}>
              {showAll ? 'Show fewer' : `Show ${hiddenCount} more`}
            </Button>
          ) : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {others.length > 0 ? (
            <Button
              variant="outline"
              className="w-fit"
              disabled={pending !== null}
              onClick={() => run('others', () => authClient.revokeOtherSessions())}
            >
              {pending === 'others' ? <Loader2Icon className="size-4 animate-spin" /> : null}
              Sign out all other devices
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">This is the only device signed in.</p>
          )}
        </div>
      )}
    </SettingsSection>
  )
}
