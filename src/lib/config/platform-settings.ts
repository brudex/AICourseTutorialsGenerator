/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: PLATFORM_SETTING_GROUPS, PLATFORM_SETTING_FIELDS,
 *   platformSettingGroup, PLATFORM_SETTINGS_REFRESH_MS, platform settings
 *   registry, runtime configuration, portal settings
 *
 * WHAT:  Every operator setting that is edited in /portal/settings instead of
 *        the server file: email, publishing apps, media storage, rendering,
 *        background worker, security, sign up and sign in, and branding.
 * WHY:   One registry drives the database rows, the typed readers, the form
 *        and its validation. Values are read at runtime from the database, so
 *        a change applies within PLATFORM_SETTINGS_REFRESH_MS with no restart.
 *        Values that must exist before the database can be read (database
 *        address, auth secret, encryption key, portal owner) stay in the server
 *        file on purpose. `envFallback` keeps an existing install working until
 *        its operator saves the value here once.
 *        This file holds labels and defaults only, never values, so it is safe
 *        to import in the browser.
 * WHERE: src/lib/platform-settings (runtime reads), src/trpc/routers/portal.ts,
 *        src/app/(portal)/portal/settings.
 */

import type { PlatformSettingFieldDefinition, PlatformSettingGroupDefinition } from '@/lib/types'

/* How stale a cached value may get before the next read refreshes it. Bounds
 * how long another process (the worker) takes to see a change. */
export const PLATFORM_SETTINGS_REFRESH_MS = 5_000

export const PLATFORM_SETTING_GROUPS = [
  {
    id: 'email',
    label: 'Email',
    description: 'Sends sign up, password reset and invitation emails through Resend',
    fields: [
      {
        key: 'resendApiKey',
        label: 'Resend API key',
        help: 'From resend.com. Without it emails are skipped.',
        kind: 'text',
        secret: true,
        defaultValue: '',
        envFallback: 'RESEND_API_KEY',
        placeholder: 're_…',
      },
      {
        key: 'resendFromEmail',
        label: 'Sender address',
        help: 'An address on a domain you verified in Resend.',
        kind: 'text',
        format: 'email',
        defaultValue: 'onboarding@resend.dev',
        envFallback: 'RESEND_FROM_EMAIL',
        placeholder: 'hello@yourdomain.com',
      },
    ],
  },
  {
    id: 'publishing',
    label: 'Publishing apps',
    description: 'Your app keys so workspaces connect YouTube, Google Classroom, Drive, Vimeo and Canvas with one click',
    fields: [
      {
        key: 'googlePublishingClientId',
        label: 'Google client ID',
        help: 'OAuth client with the YouTube, Classroom and Drive APIs turned on.',
        kind: 'text',
        defaultValue: '',
        envFallback: 'GOOGLE_PUBLISHING_CLIENT_ID',
      },
      {
        key: 'googlePublishingClientSecret',
        label: 'Google client secret',
        help: 'The secret of the same Google OAuth client.',
        kind: 'text',
        secret: true,
        defaultValue: '',
        envFallback: 'GOOGLE_PUBLISHING_CLIENT_SECRET',
      },
      {
        key: 'vimeoClientId',
        label: 'Vimeo client ID',
        help: 'A Vimeo app with upload access.',
        kind: 'text',
        defaultValue: '',
        envFallback: 'VIMEO_CLIENT_ID',
      },
      {
        key: 'vimeoClientSecret',
        label: 'Vimeo client secret',
        help: 'The secret of the same Vimeo app.',
        kind: 'text',
        secret: true,
        defaultValue: '',
        envFallback: 'VIMEO_CLIENT_SECRET',
      },
      {
        key: 'canvasOAuthApps',
        label: 'Canvas developer keys',
        help: 'One key per school, as {"school.instructure.com": {"clientId": "…", "clientSecret": "…"}}.',
        kind: 'json',
        json: 'canvasOAuthApps',
        secret: true,
        defaultValue: '',
        envFallback: 'CANVAS_OAUTH_APPS',
      },
    ],
  },
  {
    id: 'storage',
    label: 'Media storage',
    description: 'Where lecture videos, narration, images and downloads are kept',
    fields: [
      {
        key: 'storageDriver',
        label: 'Storage',
        help: 'Files already saved stay where they were written.',
        kind: 'select',
        options: [
          { value: 'local', label: 'This server' },
          { value: 's3', label: 'S3 compatible bucket' },
        ],
        defaultValue: 'local',
        envFallback: 'STORAGE_DRIVER',
      },
      {
        key: 'storageLocalDir',
        label: 'Folder on this server',
        help: 'Used when storage is this server.',
        kind: 'text',
        defaultValue: '.storage',
        envFallback: 'STORAGE_LOCAL_DIR',
      },
      {
        key: 's3Bucket',
        label: 'Bucket',
        help: 'Required for S3 storage.',
        kind: 'text',
        defaultValue: '',
        envFallback: 'S3_BUCKET',
      },
      {
        key: 's3Region',
        label: 'Region',
        help: 'Use auto for Cloudflare R2.',
        kind: 'text',
        defaultValue: 'auto',
        envFallback: 'S3_REGION',
      },
      {
        key: 's3Endpoint',
        label: 'Endpoint',
        help: 'Leave blank for AWS. Set it for R2, MinIO and others.',
        kind: 'text',
        format: 'url',
        defaultValue: '',
        envFallback: 'S3_ENDPOINT',
        placeholder: 'https://…',
      },
      {
        key: 's3ForcePathStyle',
        label: 'Path style addresses',
        help: 'Turn on for MinIO and most self hosted services.',
        kind: 'boolean',
        defaultValue: 'false',
        envFallback: 'S3_FORCE_PATH_STYLE',
      },
      {
        key: 's3AccessKeyId',
        label: 'Access key ID',
        help: 'Required for S3 storage.',
        kind: 'text',
        defaultValue: '',
        envFallback: 'S3_ACCESS_KEY_ID',
      },
      {
        key: 's3SecretAccessKey',
        label: 'Secret access key',
        help: 'Required for S3 storage.',
        kind: 'text',
        secret: true,
        defaultValue: '',
        envFallback: 'S3_SECRET_ACCESS_KEY',
      },
    ],
  },
  {
    id: 'rendering',
    label: 'Rendering',
    description: 'The tools that draw slides and encode lecture videos',
    fields: [
      {
        key: 'ffmpegPath',
        label: 'FFmpeg path',
        help: 'Leave blank to use the bundled FFmpeg.',
        kind: 'text',
        defaultValue: '',
        envFallback: 'FFMPEG_PATH',
      },
      {
        key: 'chromiumExecutablePath',
        label: 'Browser path',
        help: 'Leave blank to find Chromium, Chrome or Edge. Applies the next time the browser starts.',
        kind: 'text',
        defaultValue: '',
        envFallback: 'CHROMIUM_EXECUTABLE_PATH',
      },
      {
        key: 'videoRenderConcurrency',
        label: 'Videos at once',
        help: 'How many videos each worker encodes at the same time.',
        kind: 'number',
        min: 1,
        max: 16,
        defaultValue: '1',
        envFallback: 'VIDEO_RENDER_CONCURRENCY',
      },
    ],
  },
  {
    id: 'worker',
    label: 'Background worker',
    description: 'How fast the worker picks up generation tasks',
    fields: [
      {
        key: 'workerConcurrency',
        label: 'Tasks at once',
        help: 'How many tasks each worker runs in parallel.',
        kind: 'number',
        min: 1,
        max: 64,
        defaultValue: '4',
        envFallback: 'WORKER_CONCURRENCY',
      },
      {
        key: 'workerPollIntervalMs',
        label: 'Check for work every (ms)',
        help: 'Lower picks up tasks sooner and queries the database more.',
        kind: 'number',
        min: 100,
        max: 60_000,
        defaultValue: '1000',
        envFallback: 'WORKER_POLL_INTERVAL_MS',
      },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Rate limiting and which AI provider addresses are allowed',
    fields: [
      {
        key: 'upstashRedisRestUrl',
        label: 'Upstash Redis URL',
        help: 'Turns on rate limiting. Without it requests are not limited.',
        kind: 'text',
        format: 'url',
        defaultValue: '',
        envFallback: 'UPSTASH_REDIS_REST_URL',
        placeholder: 'https://…upstash.io',
      },
      {
        key: 'upstashRedisRestToken',
        label: 'Upstash Redis token',
        help: 'The REST token of the same database.',
        kind: 'text',
        secret: true,
        defaultValue: '',
        envFallback: 'UPSTASH_REDIS_REST_TOKEN',
      },
      {
        key: 'aiAllowPrivateBaseUrls',
        label: 'Allow private AI addresses',
        help: 'Lets workspaces use AI servers on a private network, such as a local Ollama.',
        kind: 'boolean',
        defaultValue: 'false',
        envFallback: 'AI_ALLOW_PRIVATE_BASE_URLS',
      },
    ],
  },
  {
    id: 'signup',
    label: 'Sign up and sign in',
    description: 'Who can create an account and how people sign in',
    fields: [
      {
        key: 'registrationOpen',
        label: 'Open sign up',
        help: 'Turn off to make the platform invitation only.',
        kind: 'boolean',
        defaultValue: 'true',
        envFallback: 'NEXT_PUBLIC_REGISTRATION_OPEN',
      },
      {
        key: 'googleSignInClientId',
        label: 'Google sign in client ID',
        help: 'Shows Continue with Google. Redirect address: <app address>/api/auth/callback/google.',
        kind: 'text',
        defaultValue: '',
        envFallback: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
      },
      {
        key: 'googleSignInClientSecret',
        label: 'Google sign in client secret',
        help: 'The secret of the same Google OAuth client.',
        kind: 'text',
        secret: true,
        defaultValue: '',
        envFallback: 'GOOGLE_CLIENT_SECRET',
      },
    ],
  },
  {
    id: 'branding',
    label: 'Branding',
    description: 'The name and description shown in the app, emails and browser tabs',
    fields: [
      {
        key: 'appName',
        label: 'App name',
        help: 'Shown in the sidebar, sign in pages, emails and page titles.',
        kind: 'text',
        defaultValue: 'Penrose Studio',
        envFallback: 'NEXT_PUBLIC_APP_NAME',
      },
      {
        key: 'appDescription',
        label: 'Description',
        help: 'Used for search results and link previews. Leave blank for the default.',
        kind: 'text',
        defaultValue: '',
        envFallback: 'NEXT_PUBLIC_APP_DESCRIPTION',
      },
    ],
  },
] as const satisfies readonly PlatformSettingGroupDefinition[]

/**
 * SOURCE OF TRUTH KEYWORDS: PLATFORM_SETTING_FIELDS, platformSettingField
 *
 * WHAT:  Registry fields by key, for O(1) lookup at read time.
 * WHERE: src/lib/platform-settings/store.ts, portal router.
 */
export const PLATFORM_SETTING_FIELDS: ReadonlyMap<string, PlatformSettingFieldDefinition> = new Map(
  PLATFORM_SETTING_GROUPS.flatMap((group) => group.fields.map((field) => [field.key, field] as const))
)

/**
 * SOURCE OF TRUTH KEYWORDS: platformSettingGroup
 *
 * WHAT:  The group with this id, or undefined.
 * WHERE: portal.updateSettings.
 */
export function platformSettingGroup(groupId: string): PlatformSettingGroupDefinition | undefined {
  return PLATFORM_SETTING_GROUPS.find((group) => group.id === groupId)
}
