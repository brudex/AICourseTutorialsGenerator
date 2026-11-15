/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: PlatformSettingKind, PlatformSettingFieldDefinition,
 *   PlatformSettingGroupDefinition, PlatformSettingKey, PlatformSettingKeyOf,
 *   PlatformSettingGroupId, PlatformSettingSource, PlatformSettingsView,
 *   platformSettingsGroupFormSchema, updatePlatformSettingsSchema,
 *   canvasOAuthAppsSchema, PlatformSettingsLoader
 *
 * WHAT:  The contract for operator settings managed in /portal/settings: the
 *        shape of a registry field and group, key unions DERIVED from the
 *        PLATFORM_SETTING_GROUPS registry, the per-field zod validation, and
 *        the view the portal form renders.
 * WHY:   The registry is the one place a setting is declared. Every type here
 *        is computed from it, so adding a field to the registry is the whole
 *        change: the key union, the typed readers and the form schema follow.
 *        Every value is stored as a string; the field `kind` decides how it is
 *        validated on write and parsed on read.
 * WHERE: Registry in src/lib/config/platform-settings.ts, runtime store in
 *        src/lib/platform-settings, portal router (getSettings/updateSettings),
 *        and the /portal/settings form.
 */

import { z } from 'zod'

import type { PLATFORM_SETTING_GROUPS } from '@/lib/config/platform-settings'

export const PLATFORM_SETTING_KINDS = ['text', 'boolean', 'number', 'select', 'json'] as const
export type PlatformSettingKind = (typeof PLATFORM_SETTING_KINDS)[number]

/**
 * SOURCE OF TRUTH KEYWORDS: canvasOAuthAppsSchema, PLATFORM_SETTING_JSON_SCHEMAS,
 *   PlatformSettingJsonShape, Canvas developer keys
 *
 * WHAT:  Zod schemas for settings whose value is JSON, keyed by shape id.
 * WHY:   A JSON field names its shape in the registry, so the same schema
 *        validates the portal form and parses the value at read time.
 * WHERE: platformSettingValueSchema below; src/lib/publishing/apps.ts.
 */
export const canvasOAuthAppsSchema = z.record(
  z.string().min(1),
  z.object({ clientId: z.string().min(1), clientSecret: z.string().min(1) })
)

export const PLATFORM_SETTING_JSON_SCHEMAS = {
  canvasOAuthApps: canvasOAuthAppsSchema,
} as const
export type PlatformSettingJsonShape = keyof typeof PLATFORM_SETTING_JSON_SCHEMAS

export interface PlatformSettingOption {
  value: string
  label: string
}

/**
 * SOURCE OF TRUTH KEYWORDS: PlatformSettingFieldDefinition
 *
 * WHAT:  One setting in the registry.
 * WHERE: PLATFORM_SETTING_GROUPS fields.
 */
export interface PlatformSettingFieldDefinition {
  /** Stable id, also the PlatformSetting row key. */
  key: string
  label: string
  /** One line shown under the input. */
  help: string
  kind: PlatformSettingKind
  /** Encrypted at rest and never sent back to the browser. */
  secret?: boolean
  /** Serialized value used when nothing is saved. */
  defaultValue: string
  /** Server file variable still honoured until a value is saved here. */
  envFallback?: string
  placeholder?: string
  /** Allowed values for `select`. */
  options?: readonly PlatformSettingOption[]
  /** Extra text validation. */
  format?: 'url' | 'email'
  /** Bounds for `number`. */
  min?: number
  max?: number
  /** Shape of a `json` value. */
  json?: PlatformSettingJsonShape
}

export interface PlatformSettingGroupDefinition {
  id: string
  label: string
  description: string
  fields: readonly PlatformSettingFieldDefinition[]
}

/* Derived from the registry: adding a field there extends every union here. */
type PlatformSettingGroups = typeof PLATFORM_SETTING_GROUPS
export type PlatformSettingGroupId = PlatformSettingGroups[number]['id']
type PlatformSettingField = PlatformSettingGroups[number]['fields'][number]
export type PlatformSettingKey = PlatformSettingField['key']
/** Keys of one kind, so each typed reader only accepts matching settings. */
export type PlatformSettingKeyOf<K extends PlatformSettingKind> = Extract<PlatformSettingField, { kind: K }>['key']

/** Where a resolved value came from. */
export type PlatformSettingSource = 'saved' | 'server' | 'default'

/**
 * SOURCE OF TRUTH KEYWORDS: PlatformSettingState, PlatformSettingsView
 *
 * WHAT:  What the portal form sees for each setting. A secret never carries its
 *        value, only whether one is set and its last four characters.
 * WHERE: portal.getSettings → /portal/settings.
 */
export interface PlatformSettingState {
  key: PlatformSettingKey
  value: string
  source: PlatformSettingSource
  hasValue: boolean
  last4: string | null
  updatedAt: Date | null
}
export type PlatformSettingsView = readonly PlatformSettingState[]

/** Loads saved values (secrets decrypted) for the runtime store. */
export type PlatformSettingsLoader = () => Promise<ReadonlyMap<string, string>>

/** The per-process cache behind src/lib/platform-settings/store.ts. */
export interface PlatformSettingsStoreState {
  saved: ReadonlyMap<string, string> | null
  loadedAt: number
  inflight: Promise<void> | null
  loader: PlatformSettingsLoader | null
}

/**
 * SOURCE OF TRUTH KEYWORDS: platformSettingValueSchema
 *
 * WHAT:  Validation for one serialized value. An empty string always passes:
 *        it means "not set" (a secret keeps its saved value, anything else
 *        falls back to the server file or the default).
 * WHERE: platformSettingsGroupFormSchema.
 */
export function platformSettingValueSchema(field: PlatformSettingFieldDefinition): z.ZodType<string, string> {
  const blank = z.literal('')
  switch (field.kind) {
    case 'boolean':
      return z.enum(['true', 'false'])
    case 'select': {
      const values = (field.options ?? []).map((option) => option.value)
      return z.string().refine((value) => values.includes(value), 'Choose one of the options.')
    }
    case 'number': {
      const min = field.min ?? 0
      const max = field.max ?? Number.MAX_SAFE_INTEGER
      return z.union([
        blank,
        z
          .string()
          .trim()
          .regex(/^\d+$/, 'Enter a whole number.')
          .refine((value) => Number(value) >= min && Number(value) <= max, `Enter a number from ${min} to ${max}.`),
      ])
    }
    case 'json': {
      const shape = field.json ? PLATFORM_SETTING_JSON_SCHEMAS[field.json] : null
      return z.union([
        blank,
        z.string().refine((value) => {
          try {
            const parsed = JSON.parse(value)
            return shape ? shape.safeParse(parsed).success : true
          } catch {
            return false
          }
        }, 'Enter valid JSON in the shape shown above.'),
      ])
    }
    case 'text': {
      const text = z.string().trim().max(2000)
      if (field.format === 'url') return z.union([blank, text.url('Enter a valid URL.')])
      if (field.format === 'email') return z.union([blank, text.email('Enter a valid email address.')])
      return text
    }
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: platformSettingsGroupFormSchema,
 *   PlatformSettingsFormValues
 *
 * WHAT:  A zod object for one settings group, built from its registry fields.
 * WHY:   The form and the router validate with the same generated schema.
 * WHERE: /portal/settings group form (zodResolver), portal.updateSettings.
 */
export function platformSettingsGroupFormSchema(group: PlatformSettingGroupDefinition) {
  return z.object(Object.fromEntries(group.fields.map((field) => [field.key, platformSettingValueSchema(field)])))
}
export type PlatformSettingsFormValues = Partial<Record<PlatformSettingKey, string>>

/**
 * SOURCE OF TRUTH KEYWORDS: updatePlatformSettingsSchema, UpdatePlatformSettingsValues
 *
 * WHAT:  Input for portal.updateSettings: one group's values plus the secret
 *        keys to remove. The router re-validates `values` with the group schema.
 * WHERE: src/trpc/routers/portal.ts.
 */
export const updatePlatformSettingsSchema = z.object({
  groupId: z.string().min(1),
  values: z.record(z.string(), z.string()),
  clear: z.array(z.string()).default([]),
})
export type UpdatePlatformSettingsValues = z.infer<typeof updatePlatformSettingsSchema>
