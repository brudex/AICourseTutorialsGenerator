/**
 * SOURCE OF TRUTH KEYWORDS: SUBSCRIPTIONS_ENABLED, subscriptions switch,
 *   internal use, billing off, NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED, INTERNAL_PLAN_NAME
 *
 * WHAT:  One switch for the whole subscription layer. Off by default.
 * WHY:   The app is used internally for now: nobody should hit a plan limit,
 *        see upgrade prompts, or pick a plan at onboarding. Turning it off
 *        changes behaviour in three places only (the tier resolver, the
 *        sidebar and onboarding); every billing file, plan, gate and Stripe
 *        route stays in the codebase, so setting
 *        NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED=true restores plans as they were.
 *        NEXT_PUBLIC so client screens read the same value as the server.
 * WHERE: getOrganizationTier (src/lib/feature-gate.ts), getSidebarNav
 *        (src/lib/resources.ts), OnboardingFlow.
 */
export const SUBSCRIPTIONS_ENABLED = false

/** Shown as the plan name while subscriptions are off. */
export const INTERNAL_PLAN_NAME = 'Internal'
