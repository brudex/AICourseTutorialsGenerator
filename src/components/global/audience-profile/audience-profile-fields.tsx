'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: AudienceProfileFields, learner level picker,
 *   audience specialization form, age range, prior knowledge, learning
 *   goals, customize audience
 *
 * WHAT:  The learner level picker (Toddlers to PhD and Professionals) with an
 *        optional "Customize this audience" panel for age range, prior
 *        knowledge and learning goals (hidden when AUDIENCE_CUSTOMIZE_ENABLED
 *        is false). Controlled: value in, next value out.
 * WHY:   Every new-course flow asks the same question before anything is
 *        generated, so the picker is one component. It is controlled (not
 *        bound to a form path) so any React Hook Form shape can mount it as a
 *        single FormField over an AudienceProfile; audienceProfileSchema does
 *        the validation and the field's FormMessage shows its errors. Level
 *        text and default ages come from LEARNER_LEVEL_GUIDES.
 * WHERE: CourseBriefForm and BookCourseForm (/dashboard/courses/new).
 */

import * as React from 'react'
import { CheckIcon, ChevronDownIcon, SlidersHorizontalIcon } from 'lucide-react'

import { AUDIENCE_AGE_LIMITS, AUDIENCE_TEXT_LIMITS, type AudienceProfile } from '@/lib/types'
import { AUDIENCE_CUSTOMIZE_ENABLED, LEARNER_LEVEL_GUIDES, offeredLearnerLevels } from '@/lib/config/learner-levels'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface AudienceProfileFieldsProps {
  value: AudienceProfile
  onChange: (next: AudienceProfile) => void
  disabled?: boolean
  /** Start with the customize panel open. */
  defaultCustomizeOpen?: boolean
}

/* Empty input means "use the level's usual age". */
function toAge(raw: string): number | null {
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : null
}

export function AudienceProfileFields({ value, onChange, disabled, defaultCustomizeOpen = false }: AudienceProfileFieldsProps) {
  const id = React.useId()
  const guide = LEARNER_LEVEL_GUIDES[value.level]
  const set = <K extends keyof AudienceProfile>(key: K, next: AudienceProfile[K]) => onChange({ ...value, [key]: next })

  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Learner level" className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {offeredLearnerLevels(value.level).map((level) => {
          const selected = value.level === level
          return (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => set('level', level)}
              className={cn(
                'rounded-lg border p-3 text-left transition-colors disabled:opacity-50',
                selected ? 'border-foreground bg-muted' : 'hover:bg-muted/50'
              )}
            >
              <span className="flex items-center justify-between gap-1 text-sm font-medium">
                {LEARNER_LEVEL_GUIDES[level].label}
                {selected ? <CheckIcon className="size-4 shrink-0" /> : null}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{LEARNER_LEVEL_GUIDES[level].summary}</span>
            </button>
          )
        })}
      </div>

      {AUDIENCE_CUSTOMIZE_ENABLED ? (
        <Collapsible defaultOpen={defaultCustomizeOpen}>
          <CollapsibleTrigger
            disabled={disabled}
            className="group flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <SlidersHorizontalIcon className="size-3.5" />
            Customize this audience
            <ChevronDownIcon className="size-3.5 transition-transform group-data-[panel-open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-4 rounded-lg border p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {(['ageMin', 'ageMax'] as const).map((key) => (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={`${id}-${key}`}>{key === 'ageMin' ? 'Youngest age' : 'Oldest age'}</Label>
                  <Input
                    id={`${id}-${key}`}
                    type="number"
                    inputMode="numeric"
                    min={AUDIENCE_AGE_LIMITS.min}
                    max={AUDIENCE_AGE_LIMITS.max}
                    disabled={disabled}
                    placeholder={guide.ages ? String(key === 'ageMin' ? guide.ages.min : guide.ages.max) : 'Any'}
                    value={value[key] ?? ''}
                    onChange={(event) => set(key, toAge(event.target.value))}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-prior`}>Prior knowledge</Label>
              <Input
                id={`${id}-prior`}
                maxLength={AUDIENCE_TEXT_LIMITS.priorKnowledge}
                disabled={disabled}
                placeholder="e.g. Knows basic algebra, new to statistics"
                value={value.priorKnowledge}
                onChange={(event) => set('priorKnowledge', event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-goals`}>Learning goals</Label>
              <Textarea
                id={`${id}-goals`}
                rows={3}
                maxLength={AUDIENCE_TEXT_LIMITS.learningGoals}
                disabled={disabled}
                placeholder="e.g. Pass the end of year exam and use the ideas in a school project"
                value={value.learningGoals}
                onChange={(event) => set('learningGoals', event.target.value)}
              />
            </div>
            <p className="text-xs text-muted-foreground">Optional. Empty ages use the usual range for {guide.label}.</p>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}
