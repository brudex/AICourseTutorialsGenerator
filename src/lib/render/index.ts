import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: render barrel, src/lib/render
 *
 * WHAT:  Public surface of the visual renderer (worker-side only).
 * WHERE: Visual renderer agent; worker shutdown (closeRenderBrowser).
 */

export { renderMermaidSvg } from './mermaid'
export { normalizeMermaid } from './mermaid-normalize'
export type { MermaidRenderResult } from './mermaid'
export { renderSceneStill } from './scene-still'
export { closeRenderBrowser } from './browser'
export { buildWebVtt } from './captions'
export { renderLectureVideo } from './video'
export type { VideoSceneInput } from './video'
export type { CaptionScene } from './captions'
export { renderPdf, workbookHtml, answerKeyHtml, cheatSheetHtml, glossaryHtml } from './documents'
export { buildSourceArchive } from './source-archive'
