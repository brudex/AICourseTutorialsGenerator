import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: katexCss, KaTeX fonts inline, math slide CSS
 *
 * WHAT:  KaTeX's stylesheet with its fonts embedded as woff2 data URLs,
 *        read once from node_modules and cached.
 * WHY:   Slides are rendered from an HTML string (page.setContent), which
 *        has no base URL, so KaTeX's relative font URLs would not load and
 *        formulas would fall back to system fonts. Only woff2 is kept
 *        (Chromium reads it); about 300 KB, added only to MATH_STEPS slides.
 * WHERE: src/lib/render/slide-template.ts.
 */

import { readFile } from 'node:fs/promises'
import path from 'node:path'

const KATEX_DIST = path.join(process.cwd(), 'node_modules', 'katex', 'dist')

let cached: Promise<string> | null = null

async function build(): Promise<string> {
  const css = await readFile(path.join(KATEX_DIST, 'katex.min.css'), 'utf8')
  const fonts = new Map<string, string>()
  for (const match of css.matchAll(/url\(fonts\/([^)]+?\.woff2)\)/g)) {
    const file = match[1] as string
    if (!fonts.has(file)) fonts.set(file, (await readFile(path.join(KATEX_DIST, 'fonts', file))).toString('base64'))
  }
  return css.replace(/src:url\(fonts\/([^)]+?\.woff2)\) format\("woff2"\)[^;}]*/g, (_all, file: string) => `src:url(data:font/woff2;base64,${fonts.get(file) ?? ''}) format("woff2")`)
}

export function katexCss(): Promise<string> {
  cached ??= build().catch((error: unknown) => {
    cached = null
    throw error
  })
  return cached
}
