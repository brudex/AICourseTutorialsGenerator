/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: prisma, DbClient, appName, APP_URL, APP_DOMAIN,
 *   appDescription, googleSignInApp, APP_METADATA_BASE, BRANDING, AUTH_ROUTES,
 *   isRegistrationOpen, PLANS, PlanKey, PlanDefinition, resend,
 *   AUTH_CALLBACK_PARAM, resolveAuthCallback, authRouteWithCallback,
 *   getResendClient, resendDefaultFrom, isResendConfigured, ROUTES,
 *   AppRouteKey, PLAN_ORDER, BillingInterval, getPlanPriceId, getPlanByPriceId,
 *   getNextPlan, isPaidPlan, getStripeClient, isStripeConfigured,
 *   getStripeWebhookSecret, STRIPE_API_VERSION, portalConfig, isPortalEnabled,
 *   isPortalOwnerEmail, PORTAL_PATH, portalRoute, PLATFORM_SETTING_GROUPS,
 *   PLATFORM_SETTING_FIELDS, platformSettingGroup
 *
 * WHAT:  Barrel re-export for the `src/lib/config/*` modules.
 * WHY:   Single import surface (`@/lib/config`) so consumers don't depend on
 *        the per-concern split, and so the prisma singleton, branding,
 *        auth-routes, plans, and registration flag can be regrouped without
 *        ripple edits.
 * WHERE: Imported broadly across the app and by src/lib/better-auth/auth.ts.
 */

export { prisma } from './prisma'
export type { DbClient } from './prisma'
export {
  appName,
  appDescription,
  APP_URL,
  APP_DOMAIN,
  APP_METADATA_BASE,
  BRANDING,
} from './branding'
export { googleSignInApp, isGoogleSignInEnabled } from './sign-in'
export {
  AUTH_ROUTES,
  AUTH_CALLBACK_PARAM,
  resolveAuthCallback,
  authRouteWithCallback,
} from './auth-routes'
export type { AuthRouteKey } from './auth-routes'
export { ROUTES } from './routes'
export { captionLanguageCode, webLanguageCode } from './languages'
export { SUBSCRIPTIONS_ENABLED, INTERNAL_PLAN_NAME } from './subscriptions'
export { JOB_KIND_LABELS, JOB_STATUS_LABELS } from './job-kinds'
export type { AppRouteKey } from './routes'
export { isRegistrationOpen } from './registration'
export {
  PLAN_KEYS,
  PLANS,
  PLAN_ORDER,
  isPaidPlan,
  getPlanPriceId,
  getPlanByPriceId,
  getNextPlan,
} from './plans'
export type { PlanKey, PlanDefinition, BillingInterval } from './plans'
export {
  getResendClient,
  resendDefaultFrom,
  isResendConfigured,
  isDevEmailFallbackActive,
} from './resend'
export {
  PLATFORM_SETTING_GROUPS,
  PLATFORM_SETTING_FIELDS,
  PLATFORM_SETTINGS_REFRESH_MS,
  platformSettingGroup,
} from './platform-settings'
export {
  portalConfig,
  isPortalEnabled,
  isPortalOwnerEmail,
  PORTAL_PATH,
  portalRoute,
} from './portal'
export {
  AI_PROVIDER_PRESETS,
  AI_CAPABILITY_LABELS,
  ROUTING_PRESET_LABELS,
  voiceCatalogFor,
  modelVoicesFor,
  resolveVoiceForModel,
  DEFAULT_VOICE,
} from './ai-providers'
export type { AiProviderPreset, SuggestedAiModel } from './ai-providers'
export {
  COURSE_MATERIALS,
  MATERIAL_BUILD_ORDER,
  MATERIAL_DISPLAY_ORDER,
  EXPORT_JOB_PACKAGES,
  CODE_FILE_EXTENSIONS,
  codeFileExtension,
} from './course-materials'
export {
  PUBLISHING_PLATFORMS,
  PUBLISHING_EXPORT_GUIDES,
  OFFERED_PUBLISHING_PLATFORMS,
  PUBLISHING_EXPORT_GUIDES_ENABLED,
  isOfferedPublishingPlatform,
  PUBLISHING_CALLBACK_PATH,
} from './publishing'
export type { PublishingPlatformDefinition, ExportGuide } from './publishing'
