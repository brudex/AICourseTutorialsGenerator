'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: useLocalProgress, preview progress, completed
 *   lectures, localStorage progress
 *
 * WHAT:  Which items this viewer has completed in the studio course preview.
 * WHY:   Preview completion is a per-browser convenience in localStorage
 *        (every access in try/catch; the player works without it).
 *        useSyncExternalStore keeps server render and hydration consistent
 *        and syncs across tabs via the storage event.
 * WHERE: Studio preview player (dashboard/courses/[courseId]/learn).
 */

import * as React from 'react'
import { z } from 'zod'

const completedSchema = z.array(z.string())
const listeners = new Set<() => void>()
const EMPTY = '[]'

function storageKey(courseId: string): string {
  return `learner-progress:${courseId}`
}

function read(courseId: string): string {
  try {
    return window.localStorage.getItem(storageKey(courseId)) ?? EMPTY
  } catch {
    return EMPTY
  }
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  window.addEventListener('storage', callback)
  return () => {
    listeners.delete(callback)
    window.removeEventListener('storage', callback)
  }
}

function parse(raw: string): ReadonlySet<string> {
  try {
    const parsed = completedSchema.safeParse(JSON.parse(raw))
    return new Set(parsed.success ? parsed.data : [])
  } catch {
    return new Set()
  }
}

export function useLocalProgress(courseId: string) {
  const raw = React.useSyncExternalStore(
    subscribe,
    () => read(courseId),
    () => EMPTY
  )
  const completed = React.useMemo(() => parse(raw), [raw])

  const setCompleted = React.useCallback(
    (lessonId: string, done: boolean) => {
      const next = new Set(parse(read(courseId)))
      if (done) next.add(lessonId)
      else next.delete(lessonId)
      try {
        window.localStorage.setItem(storageKey(courseId), JSON.stringify([...next]))
      } catch {
        /* Storage unavailable (private mode) — progress just isn't kept. */
      }
      listeners.forEach((listener) => listener())
    },
    [courseId]
  )

  return { completed, setCompleted }
}
