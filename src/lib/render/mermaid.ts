import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: renderMermaidSvg, Mermaid to SVG, diagram
 *   rendering, MermaidRenderResult
 *
 * WHAT:  Renders Mermaid source to an SVG string in headless Chromium, styled
 *        with the slide theme. Returns the parser's error message when the
 *        source is invalid instead of throwing.
 * WHY:   Mermaid needs a real DOM to lay out text, so it runs in the browser.
 *        `securityLevel: 'strict'` makes Mermaid sanitise labels and drop
 *        click handlers/scripts — the source is model-written. The error text
 *        is returned so the caller can ask the model to repair the diagram.
 * WHERE: Visual renderer (src/lib/agents/visual-renderer.ts).
 */

import path from 'node:path'

import { MERMAID_THEME_VARIABLES } from '@/lib/config/slide-theme'
import { getRenderBrowser } from './browser'

export type MermaidRenderResult = { ok: true; svg: string } | { ok: false; error: string }

const MERMAID_BUNDLE = path.join(process.cwd(), 'node_modules', 'mermaid', 'dist', 'mermaid.min.js')

interface MermaidWindow {
  mermaid: {
    initialize: (config: object) => void
    parse: (text: string) => Promise<unknown>
    render: (id: string, text: string) => Promise<{ svg: string }>
  }
}

export async function renderMermaidSvg(source: string): Promise<MermaidRenderResult> {
  const browser = await getRenderBrowser()
  const page = await browser.newPage()
  try {
    await page.setContent('<!doctype html><html><body></body></html>')
    await page.addScriptTag({ path: MERMAID_BUNDLE })
    return await page.evaluate(
      async ({ text, themeVariables }) => {
        const { mermaid } = window as Window & typeof globalThis & MermaidWindow
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables })
        try {
          await mermaid.parse(text)
          const { svg } = await mermaid.render('diagram', text)
          return { ok: true as const, svg }
        } catch (error) {
          return { ok: false as const, error: error instanceof Error ? error.message : String(error) }
        }
      },
      { text: source, themeVariables: MERMAID_THEME_VARIABLES }
    )
  } finally {
    await page.close()
  }
}
