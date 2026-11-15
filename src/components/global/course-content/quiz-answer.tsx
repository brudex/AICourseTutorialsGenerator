/**
 * SOURCE OF TRUTH KEYWORDS: QuizAnswer, assessment answer view
 *
 * WHAT:  Author view of one assessment item with its correct answer marked.
 * WHERE: Lesson page Quiz tab; course Practice tab.
 */

import type { AssessmentItemContent } from '@/lib/types'

export function QuizAnswer({ content }: { content: AssessmentItemContent }) {
  switch (content.type) {
    case 'MULTIPLE_CHOICE':
    case 'SCENARIO':
    case 'MULTIPLE_RESPONSE': {
      const correct = content.type === 'MULTIPLE_RESPONSE' ? content.correctOptionIds : [content.correctOptionId]
      return (
        <div className="space-y-2">
          {content.type === 'SCENARIO' ? <p className="text-sm text-muted-foreground">{content.scenario}</p> : null}
          <p className="text-sm font-medium">{content.question}</p>
          <ul className="space-y-1 text-sm">
            {content.options.map((o) => (
              <li key={o.id} className={correct.includes(o.id) ? 'font-medium text-success' : 'text-muted-foreground'}>
                {o.id}. {o.text} {correct.includes(o.id) ? '✓' : ''}
              </li>
            ))}
          </ul>
        </div>
      )
    }
    case 'TRUE_FALSE':
      return (
        <p className="text-sm">
          <span className="font-medium">{content.statement}</span> · {content.answer ? 'True' : 'False'}
        </p>
      )
    case 'FILL_BLANK':
      return (
        <p className="text-sm">
          <span className="font-medium">{content.text}</span> · {content.answers.join(', ')}
        </p>
      )
    case 'SHORT_ANSWER':
      return (
        <div className="space-y-1 text-sm">
          <p className="font-medium">{content.question}</p>
          <p className="text-muted-foreground">Sample answer: {content.sampleAnswer}</p>
        </div>
      )
    case 'MATCHING':
      return (
        <div className="space-y-1 text-sm">
          <p className="font-medium">{content.prompt}</p>
          <ul className="text-muted-foreground">
            {content.pairs.map((p) => (
              <li key={p.left}>
                {p.left} → {p.right}
              </li>
            ))}
          </ul>
        </div>
      )
  }
}

