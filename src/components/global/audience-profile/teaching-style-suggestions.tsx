'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: TeachingStyleSuggestions, teaching style chips,
 *   suggested teaching styles per learner level
 *
 * WHAT:  One-click teaching style chips under a teaching style input; the
 *        chosen chip is highlighted and, when `clearable`, clicking it again
 *        empties the field.
 * WHY:   Both new-course flows offer the learner level's suggested styles
 *        (LearnerLevelGuide.teachingStyles); one component keeps them alike.
 * WHERE: CourseBriefForm, BookCourseForm.
 */

import { cn } from '@/lib/utils'

export interface TeachingStyleSuggestionsProps {
  suggestions: readonly string[]
  value: string
  onChange: (next: string) => void
  disabled?: boolean
  clearable?: boolean
}

export function TeachingStyleSuggestions({ suggestions, value, onChange, disabled, clearable = false }: TeachingStyleSuggestionsProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {suggestions.map((style) => (
        <button
          key={style}
          type="button"
          disabled={disabled}
          onClick={() => onChange(clearable && value === style ? '' : style)}
          className={cn(
            'rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50',
            value === style && 'border-foreground text-foreground'
          )}
        >
          {style}
        </button>
      ))}
    </div>
  )
}
