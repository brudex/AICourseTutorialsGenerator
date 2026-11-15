import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: escapeHtml, highlightCodeHtml, render HTML
 *   helpers, Shiki, LESSON_FIGURE_CSS, lesson figure styles
 *
 * WHAT:  Shared helpers for every server-rendered document (slides, PDFs):
 *        HTML escaping, Shiki syntax highlighting with optional line marks,
 *        and the lesson figure styles shared by the workbook and SCORM player.
 * WHY:   Model-written text reaches generated HTML in several renderers; one
 *        escaping function means one place to get it right. Unknown code
 *        languages fall back to plain text instead of failing the render.
 * WHERE: src/lib/render/slide-template.ts and src/lib/render/documents.ts.
 */

import { codeToHtml, type ShikiTransformer } from 'shiki'
import { SLIDE_THEME } from '@/lib/config/slide-theme'

/* Figure styles shared by the workbook and the SCORM player; kept here so
 * neither renderer imports the other (a module cycle). Diagrams are
 * drawn in the dark video theme, so they sit on its background on paper. */
export const LESSON_FIGURE_CSS = `
  .lesson-figure { margin: 14pt 0; break-inside: avoid; }
  .lesson-figure img { display: block; width: 100%; height: auto; border-radius: 8px; }
  .lesson-figure-diagram img { background: ${SLIDE_THEME.background}; padding: 12px; max-height: 420px; object-fit: contain; }
  .lesson-figure figcaption { margin-top: 6px; font-size: 0.9em; opacity: 0.75; }
`

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function highlightCodeHtml(
  code: string,
  language: string,
  theme: string,
  highlightedLines: ReadonlySet<number> = new Set()
): Promise<string> {
  const markHighlighted: ShikiTransformer = {
    line(node, line) {
      if (highlightedLines.has(line)) this.addClassToHast(node, 'hl')
    },
  }
  const options = (lang: string) => ({ lang, theme, transformers: [markHighlighted] })
  try {
    return await codeToHtml(code, options(language.toLowerCase()))
  } catch {
    return codeToHtml(code, options('text'))
  }
}
