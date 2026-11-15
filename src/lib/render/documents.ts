import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: renderPdf, workbookHtml, answerKeyHtml,
 *   cheatSheetHtml, glossaryHtml, course PDF documents, print HTML,
 *   page.pdf, PRINT_THEME
 *
 * WHAT:  Builds the printable HTML of every PDF download (workbook, answer
 *        key, cheat sheet, glossary) from a MaterialSource and prints it to
 *        PDF with the shared headless Chromium.
 * WHY:   HTML + Chromium print gives real typography, highlighted code, page
 *        breaks and page numbers without a PDF layout library, and reuses the
 *        renderer the slides already use. Every model-written string passes
 *        through escapeHtml. The workbook never contains answers; everything
 *        a learner should not see before trying lives in the answer key,
 *        which is instructor only (COURSE_MATERIALS.audience).
 * WHERE: materialsBuilder agent (src/lib/agents/materials-builder.ts).
 */

import { PRINT_THEME as T } from '@/lib/config/print-theme'
import type { AssessmentItemContent, LessonContent, LessonFigure, LessonSection, MaterialLesson, MaterialSource, ProjectBrief } from '@/lib/types'
import { getRenderBrowser } from './browser'
import { escapeHtml as esc, highlightCodeHtml, LESSON_FIGURE_CSS } from './html'

// ── Building blocks ──────────────────────────────────────────────────────

const highlight = (code: string, language: string) => highlightCodeHtml(code, language, T.codeTheme)

/* Escaped text with `inline code` and paragraph breaks preserved. */
function prose(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/`([^`]+)`/g, '<code>$1</code>')}</p>`)
    .join('')
}

const list = (items: readonly string[], className = '') =>
  items.length ? `<ul class="${className}">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''

const STYLES = `
  @page { size: ${T.pageFormat}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ${T.fontSans}; color: ${T.ink}; font-size: 10.5pt; line-height: 1.55; }
  h1 { font-size: 26pt; line-height: 1.15; margin: 0 0 6pt; letter-spacing: -0.02em; }
  h2 { font-size: 17pt; margin: 0 0 4pt; letter-spacing: -0.01em; }
  h3 { font-size: 12.5pt; margin: 18pt 0 6pt; }
  h4 { font-size: 10.5pt; margin: 12pt 0 4pt; }
  h2, h3, h4, .label { break-after: avoid; }
  p { margin: 0 0 7pt; }
  ul, ol { margin: 0 0 8pt; padding-left: 16pt; }
  li { margin-bottom: 3pt; }
  code { font-family: ${T.fontMono}; font-size: 9pt; background: ${T.panel}; padding: 0 3pt; border-radius: 3pt; }
  pre.shiki { font-family: ${T.fontMono}; font-size: 8.8pt; line-height: 1.5; padding: 9pt 11pt; border-radius: 6pt;
    border: 1px solid ${T.rule}; white-space: pre-wrap; word-break: break-word; margin: 4pt 0 10pt; break-inside: avoid; }
  pre.shiki code { background: none; padding: 0; font-size: inherit; }
  .kicker { color: ${T.accent}; font-size: 9pt; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6pt; }
  .muted { color: ${T.muted}; }
  .cover { padding: 30pt 0 20pt; border-bottom: 2px solid ${T.ink}; margin-bottom: 18pt; }
  .cover .subtitle { font-size: 13pt; color: ${T.muted}; margin: 0; }
  .chapter { break-before: page; }
  ${LESSON_FIGURE_CSS}
  .box { background: ${T.panel}; border: 1px solid ${T.rule}; border-radius: 7pt; padding: 10pt 12pt; margin: 8pt 0 12pt; break-inside: avoid; }
  .box.accent { background: ${T.accentSoft}; border-color: ${T.accentSoft}; }
  .box > :last-child { margin-bottom: 0; }
  .box > h4:first-child { margin-top: 0; }
  .label { font-size: 8.5pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: ${T.muted}; margin-bottom: 4pt; }
  .question { break-inside: avoid; margin: 0 0 12pt; }
  .question .stem { font-weight: 600; margin-bottom: 4pt; }
  .options { list-style: none; padding-left: 0; }
  .options li { padding-left: 18pt; text-indent: -18pt; }
  .correct { color: ${T.success}; font-weight: 600; }
  .answer { color: ${T.success}; }
  .lines { height: 54pt; background: repeating-linear-gradient(to bottom, transparent 0 17pt, ${T.rule} 17pt 18pt); margin: 4pt 0 6pt; }
  table { width: 100%; border-collapse: collapse; margin: 4pt 0 10pt; }
  th, td { text-align: left; vertical-align: top; padding: 5pt 7pt; border-bottom: 1px solid ${T.rule}; }
  th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.05em; color: ${T.muted}; }
  .toc li { margin-bottom: 2pt; }
  .file { font-family: ${T.fontMono}; font-size: 9pt; font-weight: 600; margin: 10pt 0 2pt; }
`

function documentShell(params: { kicker: string; course: MaterialSource['course']; intro: string; body: string; extraStyles?: string }): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLES}${params.extraStyles ?? ''}</style></head><body>
    <header class="cover">
      <div class="kicker">${esc(params.kicker)}</div>
      <h1>${esc(params.course.title)}</h1>
      ${params.course.subtitle ? `<p class="subtitle">${esc(params.course.subtitle)}</p>` : ''}
    </header>
    ${params.intro}
    ${params.body}
  </body></html>`
}

// ── Questions ────────────────────────────────────────────────────────────

const OPTION_LETTERS = 'ABCDEF'

function optionsHtml(options: ReadonlyArray<{ id: string; text: string }>, correct: ReadonlySet<string> | null): string {
  return `<ul class="options">${options
    .map((o, i) => {
      const right = correct?.has(o.id) ?? false
      return `<li class="${right ? 'correct' : ''}">${right ? '✓' : '○'}&nbsp; ${OPTION_LETTERS[i] ?? ''}. ${esc(o.text)}</li>`
    })
    .join('')}</ul>`
}

/* One question; `withAnswer` adds the answer and explanation (answer key only). */
function questionHtml(item: AssessmentItemContent, number: number, withAnswer: boolean): string {
  const stem = (text: string) => `<div class="stem">${number}. ${esc(text)}</div>`
  const explain = withAnswer ? `<p class="muted">${esc(item.explanation)}</p>` : ''
  let body: string
  switch (item.type) {
    case 'MULTIPLE_CHOICE':
      body = stem(item.question) + optionsHtml(item.options, withAnswer ? new Set([item.correctOptionId]) : null)
      break
    case 'SCENARIO':
      body = `${prose(item.scenario)}${stem(item.question)}${optionsHtml(item.options, withAnswer ? new Set([item.correctOptionId]) : null)}`
      break
    case 'MULTIPLE_RESPONSE':
      body = `${stem(item.question)}<p class="muted">Select all that apply.</p>${optionsHtml(item.options, withAnswer ? new Set(item.correctOptionIds) : null)}`
      break
    case 'TRUE_FALSE':
      body = stem(item.statement) + (withAnswer ? `<p class="answer">Answer: ${item.answer ? 'True' : 'False'}</p>` : '<p>○ True &nbsp;&nbsp; ○ False</p>')
      break
    case 'SHORT_ANSWER':
      body =
        stem(item.question) +
        (withAnswer
          ? `<div class="answer">${prose(item.sampleAnswer)}</div><div class="label">Look for</div>${list(item.rubric)}`
          : '<div class="lines"></div>')
      break
    case 'FILL_BLANK':
      body = stem(item.text) + (withAnswer ? `<p class="answer">Answers: ${item.answers.map(esc).join(' · ')}</p>` : '')
      break
    case 'MATCHING': {
      /* Right-hand items sorted so the printed order never gives the pairs away. */
      const rights = item.pairs.map((p) => p.right).sort((a, b) => a.localeCompare(b))
      body =
        stem(item.prompt) +
        (withAnswer
          ? `<table>${item.pairs.map((p) => `<tr><td>${esc(p.left)}</td><td class="answer">${esc(p.right)}</td></tr>`).join('')}</table>`
          : `<table>${item.pairs
              .map((p, i) => `<tr><td>${i + 1}. ${esc(p.left)}</td><td>${OPTION_LETTERS[i] ?? i + 1}. ${esc(rights[i] ?? '')}</td></tr>`)
              .join('')}</table>`)
      break
    }
  }
  return `<div class="question">${body}${explain}</div>`
}

const questionsHtml = (items: readonly AssessmentItemContent[], withAnswer: boolean) =>
  items.map((item, i) => questionHtml(item, i + 1, withAnswer)).join('')

// ── Lessons ──────────────────────────────────────────────────────────────

const SECTION_LABELS: Partial<Record<LessonSection['type'], string>> = {
  analogy: 'Analogy',
  example: 'Example',
  summary: 'Summary',
  code_demo: 'Code demo',
  common_mistakes: 'Common mistakes',
  further_learning: 'Further learning',
}

async function sectionHtml(section: LessonSection): Promise<string> {
  const heading = 'heading' in section && section.heading ? section.heading : SECTION_LABELS[section.type]
  const h = heading ? `<h4>${esc(heading)}</h4>` : ''
  switch (section.type) {
    case 'hook':
    case 'explanation':
    case 'analogy':
    case 'example':
      return h + prose(section.body)
    case 'summary':
      return `<div class="box accent">${h}${prose(section.body)}</div>`
    case 'code_demo':
      return h + (await highlight(section.code, section.language)) + prose(section.explanation)
    case 'common_mistakes':
      return `${h}<table><tr><th>Mistake</th><th>Fix</th></tr>${section.items
        .map((m) => `<tr><td>${esc(m.mistake)}</td><td>${esc(m.fix)}</td></tr>`)
        .join('')}</table>`
    case 'further_learning':
      return h + list(section.items)
    case 'illustration_request':
      /* Visuals live in the lecture video; the notes keep only the text. */
      return ''
  }
}

const lessonKicker = (lesson: MaterialLesson, index: number) =>
  `<div class="kicker">Section ${lesson.modulePosition + 1} · ${esc(lesson.moduleTitle)} · Lecture ${index + 1}</div>`

function contentsHtml(lessons: readonly MaterialLesson[], extras: readonly string[]): string {
  return `<div class="box"><div class="label">Contents</div><ol class="toc">${lessons
    .map((l) => `<li>${esc(l.title)} <span class="muted">· ${esc(l.moduleTitle)}</span></li>`)
    .join('')}${extras.map((e) => `<li>${esc(e)}</li>`).join('')}</ol></div>`
}

/**
 * SOURCE OF TRUTH KEYWORDS: lessonBodyHtml, projectBriefHtml, learner HTML
 *
 * WHAT:  A lecture's notes and the learner project brief (no reference
 *        solution) as HTML fragments, shared by the workbook and the SCORM
 *        player so both show identical content.
 */
/* One lecture figure: a rendered diagram or a generated illustration. */
function figureHtml(figure: LessonFigure): string {
  return `<figure class="lesson-figure lesson-figure-${figure.kind}"><img src="${figure.src}" alt="${esc(figure.caption)}">${
    figure.caption ? `<figcaption>${esc(figure.caption)}</figcaption>` : ''
  }</figure>`
}

/**
 * Figures take the places where the lesson asked for a visual
 * (illustration_request sections), in order; any left over close the notes.
 */
export async function lessonBodyHtml(content: LessonContent, figures: readonly LessonFigure[] = []): Promise<string> {
  const queue = [...figures]
  const parts = await Promise.all(
    content.sections.map(async (section) => {
      if (section.type === 'illustration_request') {
        const figure = queue.shift()
        return figure ? figureHtml(figure) : ''
      }
      return sectionHtml(section)
    })
  )
  /* Promise.all keeps order, but the queue is consumed synchronously above. */
  return parts.join('') + queue.map(figureHtml).join('')
}



export function projectBriefHtml(p: ProjectBrief): string {
  return `<div class="kicker">Final project · about ${p.estimatedHours} hours</div>
    <h2>${esc(p.title)}</h2>
    ${prose(p.summary)}
    ${p.milestones
      .map(
        (m, i) => `<div class="box"><h4>Milestone ${i + 1}: ${esc(m.title)}</h4>${prose(m.description)}${list(m.tasks)}
        <p><strong>Deliverable:</strong> ${esc(m.deliverable)}</p></div>`
      )
      .join('')}
    <h3>How it is graded</h3>
    <table><tr><th>Criterion</th><th>What good looks like</th><th>Points</th></tr>${p.rubric
      .map((r) => `<tr><td>${esc(r.criterion)}</td><td>${esc(r.description)}</td><td>${r.points}</td></tr>`)
      .join('')}</table>
    ${p.stretchGoals.length ? `<h3>Stretch goals</h3>${list(p.stretchGoals)}` : ''}
    ${p.starterFiles.length ? '<p class="muted">Starter files are in the source code download.</p>' : ''}`
}

// ── Documents ────────────────────────────────────────────────────────────

/** Learner workbook: notes, exercises and review questions, with no answers. */
export async function workbookHtml(source: MaterialSource): Promise<string> {
  const chapters: string[] = []
  for (const [index, lesson] of source.lessons.entries()) {
    const exercises = await Promise.all(
      lesson.exercises.map(
        async (e) => `<div class="box">
          <div class="label">${esc(e.level.replace('_', ' ').toLowerCase())} · ${e.content.estimatedMinutes} min</div>
          <h4 style="margin-top:0">${esc(e.title)}</h4>
          ${prose(e.content.instructions)}
          ${e.content.starterCode ? await highlight(e.content.starterCode, e.content.language ?? 'text') : ''}
          ${e.content.expectedOutput ? `<p><strong>Expected result:</strong> ${esc(e.content.expectedOutput)}</p>` : ''}
          ${e.content.hints.length ? `<div class="label">Hints</div>${list(e.content.hints)}` : ''}
        </div>`
      )
    )
    chapters.push(`<section class="chapter">
      ${lessonKicker(lesson, index)}
      <h2>${esc(lesson.title)}</h2>
      <div class="box accent"><div class="label">In this lecture you will</div>${list(lesson.content.objectives)}</div>
      ${await lessonBodyHtml(lesson.content, lesson.figures)}
      ${exercises.length ? `<h3>Exercises</h3>${exercises.join('')}` : ''}
      ${lesson.quiz.length ? `<h3>Check your understanding</h3>${questionsHtml(lesson.quiz, false)}` : ''}
      <h3>Your notes</h3><div class="lines"></div><div class="lines"></div>
    </section>`)
  }

  const extras: string[] = []
  if (source.sectionQuizzes.length) {
    extras.push('Section reviews')
    chapters.push(
      `<section class="chapter"><h2>Section reviews</h2>${source.sectionQuizzes
        .map((s) => `<h3>${esc(s.moduleTitle)}</h3>${questionsHtml(s.items, false)}`)
        .join('')}</section>`
    )
  }
  if (source.finalAssessment.length) {
    extras.push('Final assessment')
    chapters.push(`<section class="chapter"><h2>Final assessment</h2>${questionsHtml(source.finalAssessment, false)}</section>`)
  }
  if (source.project) {
    extras.push(`Final project: ${source.project.title}`)
    chapters.push(`<section class="chapter">${projectBriefHtml(source.project)}</section>`)
  }

  return documentShell({
    kicker: 'Workbook',
    course: source.course,
    intro: `<p class="muted">Work through each lecture alongside its video: read the notes, try every exercise before checking a solution, then answer the review questions.</p>${contentsHtml(source.lessons, extras)}`,
    body: chapters.join(''),
  })
}

/** Instructor answer key: solutions, every answer with its explanation, rubric and reference solution. */
export async function answerKeyHtml(source: MaterialSource): Promise<string> {
  const chapters: string[] = []
  for (const [index, lesson] of source.lessons.entries()) {
    if (lesson.exercises.length === 0 && lesson.quiz.length === 0) continue
    const solutions = await Promise.all(
      lesson.exercises.map(
        async (e) => `<h4>${esc(e.title)}</h4>${await highlight(e.content.solution, e.content.language ?? 'text')}${
          e.content.tests ? `<div class="label">Tests</div>${await highlight(e.content.tests, e.content.language ?? 'text')}` : ''
        }`
      )
    )
    chapters.push(`<section class="chapter">
      ${lessonKicker(lesson, index)}
      <h2>${esc(lesson.title)}</h2>
      ${solutions.length ? `<h3>Exercise solutions</h3>${solutions.join('')}` : ''}
      ${lesson.quiz.length ? `<h3>Quiz answers</h3>${questionsHtml(lesson.quiz, true)}` : ''}
    </section>`)
  }
  if (source.sectionQuizzes.length) {
    chapters.push(
      `<section class="chapter"><h2>Section reviews</h2>${source.sectionQuizzes
        .map((s) => `<h3>${esc(s.moduleTitle)}</h3>${questionsHtml(s.items, true)}`)
        .join('')}</section>`
    )
  }
  if (source.finalAssessment.length) {
    chapters.push(`<section class="chapter"><h2>Final assessment</h2>${questionsHtml(source.finalAssessment, true)}</section>`)
  }
  if (source.project) {
    const p = source.project
    const files = await Promise.all(
      p.referenceSolution.map(async (f) => `<div class="file">${esc(f.path)}</div>${await highlight(f.content, f.language)}`)
    )
    chapters.push(`<section class="chapter">
      <div class="kicker">Final project</div>
      <h2>${esc(p.title)}</h2>
      <h3>Grading rubric</h3>
      <table><tr><th>Criterion</th><th>What good looks like</th><th>Points</th></tr>${p.rubric
        .map((r) => `<tr><td>${esc(r.criterion)}</td><td>${esc(r.description)}</td><td>${r.points}</td></tr>`)
        .join('')}<tr><td colspan="2"><strong>Total</strong></td><td><strong>${p.rubric.reduce((s, r) => s + r.points, 0)}</strong></td></tr></table>
      ${files.length ? `<h3>Reference solution</h3>${files.join('')}` : ''}
    </section>`)
  }
  return documentShell({
    kicker: 'Answer key · Instructor only',
    course: source.course,
    intro: '<p class="muted">Solutions to every exercise, the answer and reasoning for every question, and the project rubric. Do not share with learners.</p>',
    body: chapters.join(''),
  })
}

/** Learner cheat sheet in two dense columns. */
export async function cheatSheetHtml(source: MaterialSource): Promise<string | null> {
  const sheet = source.cheatSheet
  if (!sheet) return null
  const blocks = await Promise.all(
    sheet.sections.map(
      async (s) => `<div class="sheet-block"><h4>${esc(s.heading)}</h4>${list(s.points)}${
        s.code ? await highlight(s.code.snippet, s.code.language) : ''
      }</div>`
    )
  )
  return documentShell({
    kicker: 'Cheat sheet',
    course: { title: sheet.title, subtitle: source.course.title },
    intro: '',
    body: `<div class="sheet">${blocks.join('')}</div>`,
    extraStyles: `
      body { font-size: 9pt; }
      .cover { padding: 4pt 0 10pt; margin-bottom: 12pt; }
      h1 { font-size: 20pt; }
      .sheet { column-count: 2; column-gap: 14pt; }
      .sheet-block { break-inside: avoid; border: 1px solid ${T.rule}; border-radius: 6pt; padding: 8pt 10pt; margin-bottom: 10pt; }
      .sheet-block h4 { margin: 0 0 4pt; color: ${T.accent}; }
      .sheet-block ul { margin-bottom: 4pt; }
      pre.shiki { font-size: 7.8pt; padding: 6pt 8pt; }
    `,
  })
}

/** Learner glossary, grouped by first letter. */
export function glossaryHtml(source: MaterialSource): string | null {
  if (source.glossary.length === 0) return null
  const groups = new Map<string, MaterialSource['glossary']>()
  for (const entry of source.glossary) {
    const letter = entry.term.charAt(0).toUpperCase()
    const key = /[A-Z]/.test(letter) ? letter : '#'
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  return documentShell({
    kicker: 'Glossary',
    course: source.course,
    intro: `<p class="muted">${source.glossary.length} key terms used in this course.</p>`,
    body: [...groups.entries()]
      .map(
        ([letter, entries]) => `<h3 class="letter">${letter}</h3>${entries
          .map((e) => `<div class="term"><strong>${esc(e.term)}</strong><p>${esc(e.definition)}</p></div>`)
          .join('')}`
      )
      .join(''),
    extraStyles: `
      .letter { color: ${T.accent}; border-bottom: 1px solid ${T.rule}; padding-bottom: 2pt; }
      .term { break-inside: avoid; margin-bottom: 6pt; }
      .term p { margin: 1pt 0 0; color: ${T.muted}; }
    `,
  })
}

/** Prints document HTML to an A4 PDF with a page-numbered footer. */
export async function renderPdf(html: string, footerLabel: string): Promise<Uint8Array> {
  const browser = await getRenderBrowser()
  const page = await browser.newPage()
  try {
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    const pdf = await page.pdf({
      format: T.pageFormat,
      margin: T.margin,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:7.5pt;color:${T.muted};font-family:${T.fontSans.replace(/"/g, "'")};padding:0 16mm;display:flex;justify-content:space-between">
        <span>${esc(footerLabel)}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
    })
    return new Uint8Array(pdf)
  } finally {
    await page.close()
  }
}
