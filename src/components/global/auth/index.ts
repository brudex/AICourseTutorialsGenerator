/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: AuthForm, AuthShell, AuthError, ForgotPasswordForm,
 *   ResetPasswordForm, AuthFormProps, AuthShellProps, AuthErrorProps
 *
 * WHAT:  Barrel export for the global auth UI primitives. Mode/schema types
 *        deliberately re-exported from @/lib/types (the type source of
 *        truth) — NOT from here.
 * WHY:   One import surface for UI; one separate surface for contracts.
 * WHERE: Imported by every page under src/app/(auth)/.
 */

export { AuthScreen as AuthForm } from '@/components/global/providers/server'
export type { AuthScreenProps as AuthFormProps } from '@/components/global/providers/server'
export { AuthShell } from './auth-shell'
export { AuthError } from './auth-error'
export type { AuthErrorProps } from './auth-error'
export type { AuthShellProps } from './auth-shell'
export { ForgotPasswordScreen as ForgotPasswordForm } from '@/components/global/providers/server'
export { ResetPasswordScreen as ResetPasswordForm } from '@/components/global/providers/server'
