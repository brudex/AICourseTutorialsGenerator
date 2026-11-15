/**
 * SOURCE OF TRUTH KEYWORDS: LessonNotes, NotesSection, lesson notes renderer
 *
 * WHAT:  Renders a lesson's structured notes (LessonContent sections) as a
 *        readable article.
 * WHY:   Shared by the author lesson page and the learner player so the
 *        notes read identically in both.
 * WHERE: Lesson page Notes tab; learner player Notes tab.
 */

import type { LessonContent, LessonSection } from '@/lib/types'

function NotesSection({ section }: { section: LessonSection }) {
  switch (section.type) {
    case 'code_demo':
      return (
        <section className="space-y-2">
          {section.heading ? <h3 className="font-medium">{section.heading}</h3> : null}
          <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{section.code}</pre>
          <p className="text-sm text-muted-foreground">{section.explanation}</p>
        </section>
      )
    case 'common_mistakes':
      return (
        <section className="space-y-2">
          <h3 className="font-medium">{section.heading ?? 'Common mistakes'}</h3>
          <ul className="space-y-2 text-sm">
            {section.items.map((item) => (
              <li key={item.mistake} className="rounded-md border p-3">
                <p className="font-medium">✗ {item.mistake}</p>
                <p className="text-muted-foreground">✓ {item.fix}</p>
              </li>
            ))}
          </ul>
        </section>
      )
    case 'illustration_request':
      return (
        <section className="rounded-md border border-dashed p-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Visual · {section.kind}</p>
          <p>{section.prompt}</p>
          {section.caption ? <p className="text-xs text-muted-foreground">{section.caption}</p> : null}
        </section>
      )
    case 'further_learning':
      return (
        <section className="space-y-1">
          <h3 className="font-medium">{section.heading ?? 'Further learning'}</h3>
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            {section.items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </section>
      )
    default:
      return (
        <section className="space-y-1">
          {section.heading ? <h3 className="font-medium">{section.heading}</h3> : null}
          <p className="whitespace-pre-line text-sm leading-relaxed">{section.body}</p>
        </section>
      )
  }
}

export function LessonNotes({ notes }: { notes: LessonContent }) {
  return (
    <div className="space-y-6">
      {notes.sections.map((section, i) => (
        <NotesSection key={i} section={section} />
      ))}
    </div>
  )
}
