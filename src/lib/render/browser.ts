import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS:⁠​‌‌​​‌‌​​‌​‌‌‌​​‌‌​‌​​​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​‌‌‌‌​​​‌​​‌​‌​​​‌​​‌‌‌⁠ getRenderBrowser, closeRenderBrowser, headless
 *   Chromium, chromiumExecutablePath, Playwright
 *
 * WHAT:  One shared headless Chromium for the worker process, launched on
 *        first use and reused for every render.
 * WHY:   Launching a browser costs ~1 s; a course renders hundreds of scenes.
 *        Each render opens its own page (isolated, closed after use) on the
 *        shared browser. Launch order: the chromiumExecutablePath portal setting if set →
 *        Playwright's Chromium (`npx playwright install chromium`) → an
 *        installed Google Chrome — so development works with plain Chrome and
 *        servers can pin a browser binary.
 * WHERE: src/lib/render/mermaid.ts and scene-still.ts; closed by the worker
 *        on shutdown.
 */

import { chromium, type Browser } from 'playwright-core'

import { platformSettingText } from '@/lib/platform-settings'

let browserPromise: Promise<Browser> | null = null

async function launch(): Promise<Browser> {
  const executablePath = platformSettingText('chromiumExecutablePath')
  if (executablePath) return chromium.launch({ executablePath, headless: true })
  /* Bundled Playwright Chromium first, then installed Chrome, then Edge
   * (always present on Windows, so desktop installs need no extra download). */
  for (const options of [{}, { channel: 'chrome' }, { channel: 'msedge' }] as const) {
    try {
      return await chromium.launch({ ...options, headless: true })
    } catch {
      /* try the next browser */
    }
  }
  throw new Error(
    'No headless browser available for rendering visuals. Install Google Chrome or Microsoft Edge, run `npx playwright install chromium`, or set the browser path in portal settings under Rendering.'
  )
}

export function getRenderBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launch().catch((error: Error) => {
      browserPromise = null
      throw error
    })
  }
  return browserPromise
}

export async function closeRenderBrowser(): Promise<void> {
  if (!browserPromise) return
  const browser = await browserPromise.catch(() => null)
  browserPromise = null
  await browser?.close()
}
