'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: usePlayerSelection, PlayerSelection, lecture
 *   selection, next lecture, practice items, ?lesson= deep link
 *
 * WHAT:  Which item the course player shows (a lecture, `quiz:<moduleId>`,
 *        `final` or `project`), the playable lectures, the next lecture, and
 *        marking the current item complete.
 * WHY:   Selection lives in state and is mirrored to `?lesson=` with
 *        history.replaceState, so links and reloads land on the same item
 *        without a navigation round trip. Without one, the first lecture not
 *        completed is shown. Completing a lecture changes that default, so the
 *        current item is pinned first or the player would jump away from its
 *        end screen. A hook (not part of the view) so each caller can fetch
 *        the selected lesson with its own API before rendering the view.
 * WHERE: Studio learner preview, with CoursePlayerView.
 */

import * as React from 'react'
import { useSearchParams } from 'next/navigation'

import type { PlayerModule } from '@/lib/types'

const isPracticeId = (id: string) => id.startsWith('quiz:') || id === 'final' || id === 'project'

export function usePlayerSelection(params: {
  modules: readonly PlayerModule[]
  completed: ReadonlySet<string>
  setCompleted: (itemKey: string, done: boolean) => void
}) {
  const searchParams = useSearchParams()
  const [chosenId, setChosenId] = React.useState<string | null>(() => searchParams.get('lesson'))

  const lessons = params.modules.flatMap((m) => m.lessons)
  const playable = lessons.filter((l) => l.currentVersionId !== null)
  const practiceId = chosenId && isPracticeId(chosenId) ? chosenId : null
  const selectedId =
    practiceId ??
    (chosenId && playable.some((l) => l.id === chosenId) ? chosenId : null) ??
    playable.find((l) => !params.completed.has(l.id))?.id ??
    playable[0]?.id ??
    null
  const lectureId = practiceId === null ? selectedId : null
  const selectedIndex = playable.findIndex((l) => l.id === selectedId)
  const next = selectedIndex >= 0 ? (playable[selectedIndex + 1] ?? null) : null

  const select = React.useCallback((id: string) => {
    setChosenId(id)
    window.history.replaceState(null, '', `?lesson=${encodeURIComponent(id)}`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  function markCompleted(done: boolean) {
    if (!selectedId) return
    if (chosenId !== selectedId) setChosenId(selectedId)
    params.setCompleted(selectedId, done)
  }

  return { lessons, playable, practiceId, selectedId, lectureId, selectedIndex, next, select, markCompleted }
}
