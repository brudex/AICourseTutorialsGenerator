import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: renderSceneStill, scene still PNG, slide
 *   screenshot
 *
 * WHAT:  Renders one scene's slide (renderSlideHtml) to a 1920×1080 PNG.
 * WHY:   The still is the scene's picture as a file — used by the storyboard
 *        and learner player now, as the poster frame and PDF/slide-deck page
 *        later. Waits for fonts so text metrics are final before capture.
 * WHERE: Visual renderer (src/lib/agents/visual-renderer.ts).
 */

import { SLIDE_SIZE } from '@/lib/config/slide-theme'
import { getRenderBrowser } from './browser'
import { renderSlideHtml, type SlideRenderInput } from './slide-template'

export async function renderSceneStill(input: SlideRenderInput): Promise<Uint8Array> {
  const html = await renderSlideHtml(input)
  const browser = await getRenderBrowser()
  const page = await browser.newPage({ viewport: SLIDE_SIZE, deviceScaleFactor: 1 })
  try {
    await page.setContent(html, { waitUntil: 'load' })
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, ...SLIDE_SIZE } })
    return new Uint8Array(png)
  } finally {
    await page.close()
  }
}
