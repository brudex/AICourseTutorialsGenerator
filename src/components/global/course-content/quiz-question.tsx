'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: QuizQuestion, interactive quiz, learner quiz
 *
 * WHAT:  Learner view of one assessment item: choose, check, see the
 *        explanation. Choice types are graded; open types reveal a model
 *        answer. Right answers use the `success` token, wrong `destructive`.
 * WHERE: Learner player (lecture quiz, section quizzes, final assessment).
 */

import * as React from 'react'
import { CheckCircle2Icon, XCircleIcon } from 'lucide-react'

import type { AssessmentItemContent } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type ChoiceOption = { id: string; text: string }

/* Normalises every gradable type to options + correct ids. */
function choiceModel(content: AssessmentItemContent): { prompt: string; options: ChoiceOption[]; correct: string[]; multi: boolean } | null {
  switch (content.type) {
    case 'MULTIPLE_CHOICE':
      return { prompt: content.question, options: content.options, correct: [content.correctOptionId], multi: false }
    case 'SCENARIO':
      return { prompt: content.question, options: content.options, correct: [content.correctOptionId], multi: false }
    case 'MULTIPLE_RESPONSE':
      return { prompt: content.question, options: content.options, correct: content.correctOptionIds, multi: true }
    case 'TRUE_FALSE':
      return {
        prompt: content.statement,
        options: [
          { id: 'true', text: 'True' },
          { id: 'false', text: 'False' },
        ],
        correct: [String(content.answer)],
        multi: false,
      }
    default:
      return null
  }
}

function OpenAnswer({ content }: { content: AssessmentItemContent }) {
  switch (content.type) {
    case 'FILL_BLANK':
      return <p>Answer{content.answers.length > 1 ? 's' : ''}: {content.answers.join(', ')}</p>
    case 'SHORT_ANSWER':
      return <p>Model answer: {content.sampleAnswer}</p>
    case 'MATCHING':
      return (
        <ul>
          {content.pairs.map((p) => (
            <li key={p.left}>
              {p.left} → {p.right}
            </li>
          ))}
        </ul>
      )
    default:
      return null
  }
}

function openPrompt(content: AssessmentItemContent): string {
  if (content.type === 'FILL_BLANK') return content.text
  if (content.type === 'SHORT_ANSWER') return content.question
  if (content.type === 'MATCHING') return content.prompt
  return ''
}

export function QuizQuestion({ number, content }: { number: number; content: AssessmentItemContent }) {
  const [selected, setSelected] = React.useState<string[]>([])
  const [checked, setChecked] = React.useState(false)
  const model = choiceModel(content)

  const isCorrect =
    model !== null && selected.length === model.correct.length && selected.every((id) => model.correct.includes(id))

  function choose(id: string) {
    if (checked || !model) return
    setSelected((prev) => (model.multi ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]) : [id]))
  }

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <p className="text-xs font-medium text-muted-foreground">Question {number}</p>
        {content.type === 'SCENARIO' ? <p className="text-sm text-muted-foreground">{content.scenario}</p> : null}
        <p className="font-medium">{model ? model.prompt : openPrompt(content)}</p>

        {model ? (
          <>
            {model.multi ? <p className="text-xs text-muted-foreground">Select all that apply.</p> : null}
            <div className="grid gap-2">
              {model.options.map((option) => {
                const picked = selected.includes(option.id)
                const right = model.correct.includes(option.id)
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => choose(option.id)}
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-md border px-3 py-2.5 text-left text-sm transition-colors',
                      !checked && (picked ? 'border-foreground bg-muted' : 'hover:bg-muted/50'),
                      checked && right && 'border-success-border bg-success/10 font-medium text-success',
                      checked && picked && !right && 'border-destructive bg-destructive/10 text-destructive'
                    )}
                  >
                    {option.text}
                    {checked && right ? <CheckCircle2Icon className="size-4 shrink-0 text-success" /> : null}
                    {checked && picked && !right ? <XCircleIcon className="size-4 shrink-0" /> : null}
                  </button>
                )
              })}
            </div>
            {checked ? (
              <div
                className={cn(
                  'space-y-2 rounded-md border p-3 text-sm',
                  isCorrect ? 'border-success-border/60 bg-success/10' : 'border-destructive/40 bg-destructive/10'
                )}
              >
                <p className={cn('flex items-center gap-1.5 font-medium', isCorrect ? 'text-success' : 'text-destructive')}>
                  {isCorrect ? <CheckCircle2Icon className="size-4" /> : <XCircleIcon className="size-4" />}
                  {isCorrect ? 'Correct!' : 'Not quite.'}
                </p>
                <p className="text-muted-foreground">{content.explanation}</p>
                <Button variant="outline" size="sm" onClick={() => { setChecked(false); setSelected([]) }}>
                  Try again
                </Button>
              </div>
            ) : (
              <Button size="sm" disabled={selected.length === 0} onClick={() => setChecked(true)}>
                Check answer
              </Button>
            )}
          </>
        ) : checked ? (
          <div className="space-y-2 rounded-md bg-muted/50 p-3 text-sm">
            <OpenAnswer content={content} />
            <p className="text-muted-foreground">{content.explanation}</p>
          </div>
        ) : (
          <Button size="sm" variant="outline" onClick={() => setChecked(true)}>
            Show answer
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

