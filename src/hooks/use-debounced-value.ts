'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: useDebouncedValue, debounce, search debounce,
 *   SEARCH_DEBOUNCE_MS, typing delay
 *
 * WHAT:  Returns `value` once it has stopped changing for `delayMs`.
 * WHY:   Search boxes would otherwise send one request per keystroke.
 * WHERE: CoursesList and AuditLogsTable search fields.
 */

import * as React from 'react'

export const SEARCH_DEBOUNCE_MS = 300

export function useDebouncedValue<T>(value: T, delayMs: number = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = React.useState(value)
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
