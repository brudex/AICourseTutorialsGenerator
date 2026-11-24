import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: renderSlideHtml, slide templates, scene still
 *   layout, SlideRenderInput, highlightCode
 *
 * WHAT:  Builds a self-contained 1920×1080 HTML document for one scene — the
 *        canonical layout of every scene type as it appears in the lecture
 *        video — with syntax-highlighted code (Shiki) and the rendered
 *        diagram SVG inlined.
 * WHY:   Plain escaped HTML strings with inline styles, not React: the worker
 *        runs under the react-server condition (no react-dom/server), and a
 *        renderer must not depend on the app's CSS build. Every piece of text
 *        is HTML-escaped (model-written content); the only raw HTML inserted
 *        is Shiki output and Mermaid's sanitised SVG. Code font size scales
 *        with line count so long samples still fit the frame.
 *        The bottom ~170px is kept empty for captions (the player's and the
 *        MP4's), so the lesson/course labels sit at the TOP; the accent glow
 *        is the frame's own background, never a layer painted over the text.
 * WHERE: src/lib/render/scene-still.ts (screenshot to PNG); step 8 reuses the
 *        same layouts for video frames.
 */

import { escapeHtml, highlightCodeHtml } from './html'

import { GRAPH_THEME, SLIDE_SIZE, SLIDE_THEME as T } from '@/lib/config/slide-theme'
import { renderGraphSvg } from '@/lib/math/graph'
import type { Scene } from '@/lib/types'

export interface SlideRenderInput {
  scene: Scene
  diagramSvg: string | null
  /** ILLUSTRATION scenes: the generated picture as a data URL. */
  imageDataUrl: string | null
  lessonTitle: string
  courseTitle: string
}

const esc = escapeHtml

/** Shiki-highlighted code in the slide theme. */
function highlightCode(code: string, language: string, highlighted: ReadonlySet<number>): Promise<string> {
  return highlightCodeHtml(code, language, T.codeTheme, highlighted)
}

/* Largest font that fits the code panel (≈1560×640 px of usable space):
 * monospace glyphs are ~0.6em wide and lines are 1.55em tall. */
function codeFontSize(code: string): number {
  const lines = code.split('\n')
  const longest = Math.max(1, ...lines.map((l) => l.length + 4))
  const byWidth = 1560 / (0.6 * longest)
  const byHeight = 640 / (1.55 * lines.length)
  return Math.round(Math.max(16, Math.min(36, byWidth, byHeight)))
}

function linesBetween(ranges: ReadonlyArray<readonly [number, number]>): Set<number> {
  const set = new Set<number>()
  for (const [a, b] of ranges) for (let n = a; n <= b; n++) set.add(n)
  return set
}

const pill = (text: string, color: string, bg: string) =>
  `<span class="pill" style="color:${color};background:${bg}">${esc(text)}</span>`

const heading = (text: string, size = 60) => `<h1 style="font-size:${size}px">${esc(text)}</h1>`

async function body(input: SlideRenderInput): Promise<string> {
  const { scene } = input
  switch (scene.type) {
    case 'TITLE_CARD':
      return `<div class="center">
        <p class="eyebrow">${esc(input.courseTitle)}</p>
        <h1 style="font-size:96px;max-width:1500px">${esc(scene.onScreen.title)}</h1>
        ${scene.onScreen.subtitle ? `<p class="sub" style="font-size:40px">${esc(scene.onScreen.subtitle)}</p>` : ''}
      </div>`
    case 'TALKING_POINTS':
      return `<div class="stack">${heading(scene.onScreen.heading, 68)}
        <ul class="bullets">${scene.onScreen.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul></div>`
    case 'ILLUSTRATION':
      return `<div class="stack fill">${heading(scene.onScreen.heading, 56)}
        ${input.imageDataUrl
          ? `<div class="picture"><img src="${input.imageDataUrl}" alt=""></div>`
          : `<div class="picture empty"><p class="sub" style="font-size:30px">${esc(scene.onScreen.caption ?? scene.onScreen.heading)}</p></div>`}
        ${scene.onScreen.caption ? `<p class="sub" style="font-size:28px">${esc(scene.onScreen.caption)}</p>` : ''}</div>`
    case 'DIAGRAM':
      return `<div class="stack fill">${heading(scene.onScreen.heading, 56)}
        <div class="diagram" style="height:640px">${input.diagramSvg ?? `<p class="sub">Diagram unavailable</p>`}</div>
        ${scene.onScreen.caption ? `<p class="sub" style="font-size:28px">${esc(scene.onScreen.caption)}</p>` : ''}</div>`
    case 'GRAPH':
      return `<div class="stack fill">${heading(scene.onScreen.heading, 56)}
        <div class="diagram" style="height:680px">${input.diagramSvg ?? renderGraphSvg(scene.onScreen, GRAPH_THEME)}</div>
        ${scene.onScreen.caption ? `<p class="sub" style="font-size:28px">${esc(scene.onScreen.caption)}</p>` : ''}</div>`
    case 'CODE_WALKTHROUGH': {
      const html = await highlightCode(
        scene.onScreen.code,
        scene.onScreen.language,
        linesBetween(scene.onScreen.steps.map((s) => [s.startLine, s.endLine] as const))
      )
      return `<div class="stack fill">${heading(scene.onScreen.heading, 52)}
        <div class="code" style="font-size:${codeFontSize(scene.onScreen.code)}px">${html}</div></div>`
    }
    case 'CODE_TYPING': {
      const initial = scene.onScreen.initialCode
      const full = `${initial}${initial ? '\n' : ''}${scene.onScreen.typedCode}`
      const typedFrom = initial ? initial.split('\n').length + 1 : 1
      const typed = new Set<number>()
      for (let n = typedFrom; n <= full.split('\n').length; n++) typed.add(n)
      const html = await highlightCode(full, scene.onScreen.language, typed)
      return `<div class="stack fill">${heading(scene.onScreen.heading, 52)}
        <div class="editor"><div class="tab">${esc(scene.onScreen.fileName)}</div>
        <div class="code" style="font-size:${codeFontSize(full)}px;border-top-left-radius:0">${html}</div></div>
        ${scene.onScreen.result ? `<div class="result">▶ ${esc(scene.onScreen.result)}</div>` : ''}</div>`
    }
    case 'COMPARISON':
      return `<div class="stack">${heading(scene.onScreen.heading, 60)}
        <div class="columns">
          <div class="col" style="border-color:${T.danger};background:${T.dangerSoft}">
            <p class="col-title" style="color:${T.danger}">${esc(scene.onScreen.leftTitle)}</p>
            <ul>${scene.onScreen.left.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
          <div class="col" style="border-color:${T.success};background:${T.successSoft}">
            <p class="col-title" style="color:${T.success}">${esc(scene.onScreen.rightTitle)}</p>
            <ul>${scene.onScreen.right.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
        </div></div>`
    case 'CALLOUT': {
      const negative = scene.onScreen.kind === 'mistake' || scene.onScreen.kind === 'warning'
      const label = scene.onScreen.kind.replace('_', ' ')
      return `<div class="center">
        ${negative ? pill(label, T.danger, T.dangerSoft) : pill(label, T.accent, T.accentSoft)}
        <h1 style="font-size:72px;max-width:1500px;margin-top:40px">${esc(scene.onScreen.message)}</h1></div>`
    }
    case 'SUMMARY':
      return `<div class="stack">${heading(scene.onScreen.heading, 68)}
        <ul class="checks">${scene.onScreen.points.map((p) => `<li><span style="color:${T.success}">✓</span>${esc(p)}</li>`).join('')}</ul></div>`
    case 'EXERCISE_PROMPT':
      return `<div class="stack">${pill('Your turn', T.accent, T.accentSoft)}${heading(scene.onScreen.heading, 64)}
        <p style="font-size:44px;line-height:1.4;max-width:1500px">${esc(scene.onScreen.task)}</p>
        ${scene.onScreen.hint ? `<p class="sub" style="font-size:32px">Hint: ${esc(scene.onScreen.hint)}</p>` : ''}</div>`
    case 'QUIZ_BREAK':
      return `<div class="stack">${pill('Quick check', T.accent, T.accentSoft)}${heading(scene.onScreen.question, 60)}
        <div class="options">${scene.onScreen.options
          .map((o, i) => `<div class="option"><b>${String.fromCharCode(65 + i)}</b>${esc(o)}</div>`)
          .join('')}</div></div>`
  }
}

export async function renderSlideHtml(input: SlideRenderInput): Promise<string> {
  const { width, height } = SLIDE_SIZE
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:${width}px;height:${height}px;overflow:hidden}
  body{background:${T.background};color:${T.text};font-family:${T.fontSans};-webkit-font-smoothing:antialiased}
  .frame{position:relative;width:100%;height:100%;padding:130px 140px 170px;display:flex;flex-direction:column;background:radial-gradient(1200px 600px at 85% -10%, ${T.accentSoft}, transparent 60%)}
  h1{font-weight:700;letter-spacing:-0.02em;line-height:1.12}
  .center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:28px}
  .stack{flex:1;display:flex;flex-direction:column;justify-content:center;gap:44px;min-height:0}
  .stack.fill{gap:40px}
  .eyebrow{font-size:28px;letter-spacing:0.12em;text-transform:uppercase;color:${T.accent};font-weight:600}
  .sub{color:${T.mutedText};line-height:1.4}
  .bullets,.checks{list-style:none;display:flex;flex-direction:column;gap:30px}
  .bullets li{font-size:46px;line-height:1.35;display:flex;gap:28px}
  .bullets li::before{content:"";flex:none;width:16px;height:16px;border-radius:50%;background:${T.accent};margin-top:22px}
  .checks li{font-size:46px;line-height:1.35;display:flex;gap:26px}
  .pill{align-self:flex-start;display:inline-block;font-size:26px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;padding:12px 26px;border-radius:999px}
  .center .pill{align-self:center}
  .diagram{flex:1;min-height:0;display:flex;align-items:center;justify-content:center}
  .diagram svg{width:100%!important;height:100%!important;max-width:none!important}
  .picture{flex:1;min-height:0;border-radius:28px;overflow:hidden;border:1px solid ${T.border};background:${T.surface};display:flex;align-items:center;justify-content:center}
  .picture img{width:100%;height:100%;object-fit:cover;display:block}
  .code{max-height:100%;min-height:0;overflow:hidden;border:1px solid ${T.border};border-radius:20px;background:${T.surface};padding:32px 8px;font-family:${T.fontMono};line-height:1.55}
  .code pre{background:transparent!important;font-family:inherit}
  .code code{counter-reset:ln;display:block}
  .code .line{display:inline-block;width:100%;padding:0 28px;border-radius:6px}
  .code .line::before{counter-increment:ln;content:counter(ln);display:inline-block;width:2.2em;margin-right:1em;text-align:right;color:${T.mutedText};opacity:.55}
  .code .line.hl{background:${T.codeHighlight}}
  .editor{min-height:0;display:flex;flex-direction:column}
  .tab{align-self:flex-start;font-family:${T.fontMono};font-size:24px;color:${T.mutedText};background:${T.surface};border:1px solid ${T.border};border-bottom:none;border-radius:14px 14px 0 0;padding:12px 26px}
  .editor .code{border-top-left-radius:0}
  .result{font-family:${T.fontMono};font-size:28px;color:${T.success};background:${T.successSoft};border-radius:14px;padding:20px 28px}
  .columns{display:grid;grid-template-columns:1fr 1fr;gap:48px}
  .col{border:3px solid;border-radius:24px;padding:44px}
  .col-title{font-size:34px;font-weight:700;margin-bottom:24px}
  .col ul{list-style:none;display:flex;flex-direction:column;gap:18px;font-family:${T.fontMono};font-size:36px}
  .options{display:grid;grid-template-columns:1fr 1fr;gap:28px}
  .option{display:flex;gap:24px;align-items:center;font-size:38px;background:${T.surface};border:2px solid ${T.border};border-radius:20px;padding:30px 36px}
  .option b{color:${T.accent}}
  .footer{position:absolute;left:140px;right:140px;top:48px;display:flex;justify-content:space-between;font-size:22px;color:${T.mutedText}}
  </style></head><body><div class="frame">${await body(input)}
  <div class="footer"><span>${esc(input.lessonTitle)}</span><span>${esc(input.courseTitle)}</span></div>
  </div></body></html>`
}
