'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: PasswordInput, show password, hide password,
 *   password eye toggle, secret input
 *
 * WHAT:  A password (or API key) field with an eye button that shows or
 *        hides what was typed.
 * WHY:   Lets people check a password or key before submitting. It forwards
 *        every input prop (React Hook Form's field, autoComplete, disabled), so
 *        it drops in wherever `<Input type="password">` was used.
 * WHERE: Sign in, sign up, reset password, AI provider API keys.
 */

import * as React from 'react'
import { EyeIcon, EyeOffIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'

export type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, 'type'>

export function PasswordInput({ className, disabled, ...props }: PasswordInputProps) {
  const [visible, setVisible] = React.useState(false)
  return (
    <div className="relative">
      <Input type={visible ? 'text' : 'password'} disabled={disabled} className={cn('pr-10', className)} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        disabled={disabled}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
      >
        {visible ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </div>
  )
}
