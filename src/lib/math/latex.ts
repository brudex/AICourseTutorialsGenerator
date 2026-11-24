/**
 * SOURCE OF TRUTH KEYWORDS: renderLatexHtml, latexError, KaTeX, MATH_STEPS
 *   equation rendering, worked example maths
 *
 * WHAT:  Typesets a LaTeX formula to HTML with KaTeX (display style), and
 *        checks that a formula typesets at all.
 * WHY:   Maths in a lecture must look like maths (fractions, powers, boxed
 *        answers), not like code in an editor. KaTeX runs without a browser,
 *        is deterministic, and with its default trust:false it cannot emit
 *        links, scripts or styles from model-written input.
 * WHERE: MATH_STEPS scenes: src/lib/render/slide-template.ts (video still)
 *        and scene-frame.tsx (editor and player); latexError is the Video
 *        Director's output check, so the repair turn fixes bad LaTeX.
 *        Client-safe (the client also needs katex/dist/katex.min.css).
 */

import katex from 'katex'

/* Strips $…$ / \[…\] wrappers models add around a formula. */
function unwrap(latex: string): string {
  return latex
    .trim()
    .replace(/^\$\$([\s\S]*)\$\$$/, '$1')
    .replace(/^\$([\s\S]*)\$$/, '$1')
    .replace(/^\\\[([\s\S]*)\\\]$/, '$1')
    .replace(/^\\\(([\s\S]*)\\\)$/, '$1')
    .trim()
}

export function renderLatexHtml(latex: string): string {
  return katex.renderToString(unwrap(latex), { displayMode: true, throwOnError: false, output: 'html', strict: 'ignore' })
}

/** null when `latex` typesets, else KaTeX's message. */
export function latexError(latex: string): string | null {
  try {
    katex.renderToString(unwrap(latex), { displayMode: true, throwOnError: true, output: 'html', strict: 'ignore' })
    return null
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 200) : 'Invalid LaTeX'
  }
}
