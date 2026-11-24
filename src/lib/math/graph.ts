/**
 * SOURCE OF TRUTH KEYWORDS: renderGraphSvg, GRAPH scene, function plot,
 *   math graph SVG, curve plot, hole at a point, asymptote gap
 *
 * WHAT:  Draws a GRAPH scene as an SVG: axes, grid, tick labels, each curve
 *        y = f(x) sampled across the x range, marked points (filled, or open
 *        circles for holes such as a removable discontinuity), dashed guide
 *        lines (x = a, y = L) and a legend.
 * WHY:   Maths, science and economics lectures need the picture a plotting
 *        script would draw, not the script. Drawing it here is deterministic,
 *        safe (formulas go through compileExpression, never eval) and the same
 *        on the slide, in the editor and in the workbook. Curves break at
 *        undefined points and across vertical asymptotes instead of drawing a
 *        false line; y range is automatic unless the scene fixes it.
 * WHERE: src/lib/render/slide-template.ts (video still), visual renderer
 *        (stored as the scene's SVG for the notes), scene-frame.tsx (editor
 *        and player preview). Client-safe.
 */

import { compileExpression } from './expression'

export interface GraphSpec {
  xLabel: string | null
  yLabel: string | null
  xMin: number
  xMax: number
  yMin: number | null
  yMax: number | null
  curves: ReadonlyArray<{ expression: string; label: string | null }>
  points: ReadonlyArray<{ x: number; y: number; label: string | null; open: boolean }>
  guides: ReadonlyArray<{ axis: 'x' | 'y'; value: number; label: string | null }>
}

export interface GraphTheme {
  background: string
  text: string
  mutedText: string
  grid: string
  axis: string
  curveColors: readonly string[]
  fontFamily: string
}

const SAMPLES = 900

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/* "Nice" tick step (1, 2 or 5 × 10^n) giving about `target` ticks. */
function tickStep(span: number, target: number): number {
  const raw = span / target
  const power = Math.pow(10, Math.floor(Math.log10(raw)))
  const scaled = raw / power
  return (scaled >= 5 ? 10 : scaled >= 2 ? 5 : scaled >= 1 ? 2 : 1) * power
}

function ticks(min: number, max: number, target: number): number[] {
  const step = tickStep(max - min, target)
  const out: number[] = []
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return out
}

function formatTick(value: number): string {
  const rounded = Math.round(value * 1e6) / 1e6
  return String(rounded).replace('-', '−')
}

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] as number
}

export function renderGraphSvg(spec: GraphSpec, theme: GraphTheme, size = { width: 1600, height: 680 }): string {
  const xMin = Math.min(spec.xMin, spec.xMax)
  const xMax = Math.max(spec.xMin, spec.xMax) === xMin ? xMin + 1 : Math.max(spec.xMin, spec.xMax)

  const curves = spec.curves.map((curve) => {
    let fn: (x: number) => number
    try {
      fn = compileExpression(curve.expression)
    } catch {
      fn = () => NaN
    }
    const samples: Array<[number, number]> = []
    for (let i = 0; i <= SAMPLES; i++) {
      const x = xMin + ((xMax - xMin) * i) / SAMPLES
      samples.push([x, fn(x)])
    }
    return { ...curve, samples }
  })

  /* y range: as given, else the bulk of the curve values (percentiles keep an
   * asymptote from flattening everything), plus the marked points, padded. */
  let yMin = spec.yMin
  let yMax = spec.yMax
  if (yMin === null || yMax === null) {
    const values = curves.flatMap((c) => c.samples.map(([, y]) => y)).filter((y) => Number.isFinite(y)).sort((a, b) => a - b)
    let lo = values.length ? percentile(values, 0.03) : -1
    let hi = values.length ? percentile(values, 0.97) : 1
    for (const p of spec.points) {
      lo = Math.min(lo, p.y)
      hi = Math.max(hi, p.y)
    }
    for (const g of spec.guides) {
      if (g.axis === 'y') {
        lo = Math.min(lo, g.value)
        hi = Math.max(hi, g.value)
      }
    }
    if (hi - lo < 1e-9) {
      lo -= 1
      hi += 1
    }
    const pad = (hi - lo) * 0.1
    yMin ??= lo - pad
    yMax ??= hi + pad
  }
  if (yMax <= yMin) yMax = yMin + 1

  const { width, height } = size
  const margin = { left: 96, right: 40, top: 28, bottom: spec.xLabel ? 92 : 64 }
  const plot = { x: margin.left, y: margin.top, w: width - margin.left - margin.right, h: height - margin.top - margin.bottom }
  const px = (x: number) => plot.x + ((x - xMin) / (xMax - xMin)) * plot.w
  const py = (y: number) => plot.y + (1 - (y - (yMin)) / ((yMax) - (yMin))) * plot.h
  const fmt = (n: number) => n.toFixed(1)
  const font = `font-family="${xmlEscape(theme.fontFamily)}"`

  const parts: string[] = []
  parts.push(`<defs><clipPath id="plot-area"><rect x="${plot.x}" y="${plot.y}" width="${plot.w}" height="${plot.h}"/></clipPath></defs>`)

  /* Grid and tick labels. */
  const xTicks = ticks(xMin, xMax, 10)
  const yTicks = ticks(yMin, yMax, 7)
  for (const t of xTicks) {
    parts.push(`<line x1="${fmt(px(t))}" y1="${plot.y}" x2="${fmt(px(t))}" y2="${plot.y + plot.h}" stroke="${theme.grid}" stroke-width="1"/>`)
    parts.push(`<text x="${fmt(px(t))}" y="${plot.y + plot.h + 34}" fill="${theme.mutedText}" font-size="24" text-anchor="middle" ${font}>${formatTick(t)}</text>`)
  }
  for (const t of yTicks) {
    parts.push(`<line x1="${plot.x}" y1="${fmt(py(t))}" x2="${plot.x + plot.w}" y2="${fmt(py(t))}" stroke="${theme.grid}" stroke-width="1"/>`)
    parts.push(`<text x="${plot.x - 14}" y="${fmt(py(t) + 8)}" fill="${theme.mutedText}" font-size="24" text-anchor="end" ${font}>${formatTick(t)}</text>`)
  }
  parts.push(`<rect x="${plot.x}" y="${plot.y}" width="${plot.w}" height="${plot.h}" fill="none" stroke="${theme.grid}" stroke-width="1.5"/>`)

  /* The axes themselves where they cross the view. */
  if (yMin <= 0 && yMax >= 0) parts.push(`<line x1="${plot.x}" y1="${fmt(py(0))}" x2="${plot.x + plot.w}" y2="${fmt(py(0))}" stroke="${theme.axis}" stroke-width="2.5"/>`)
  if (xMin <= 0 && xMax >= 0) parts.push(`<line x1="${fmt(px(0))}" y1="${plot.y}" x2="${fmt(px(0))}" y2="${plot.y + plot.h}" stroke="${theme.axis}" stroke-width="2.5"/>`)

  if (spec.xLabel) {
    parts.push(`<text x="${plot.x + plot.w / 2}" y="${height - 18}" fill="${theme.text}" font-size="28" text-anchor="middle" ${font}>${xmlEscape(spec.xLabel)}</text>`)
  }
  if (spec.yLabel) {
    parts.push(`<text x="${plot.x + 16}" y="${plot.y + 36}" fill="${theme.text}" font-size="28" ${font}>${xmlEscape(spec.yLabel)}</text>`)
  }

  /* Guide lines (dashed): x = a is vertical, y = L horizontal. */
  for (const g of spec.guides) {
    const color = theme.mutedText
    if (g.axis === 'x') {
      if (g.value < xMin || g.value > xMax) continue
      parts.push(`<line x1="${fmt(px(g.value))}" y1="${plot.y}" x2="${fmt(px(g.value))}" y2="${plot.y + plot.h}" stroke="${color}" stroke-width="2.5" stroke-dasharray="12 10"/>`)
      if (g.label) parts.push(`<text x="${fmt(px(g.value) + 10)}" y="${plot.y + plot.h - 14}" fill="${color}" font-size="26" ${font}>${xmlEscape(g.label)}</text>`)
    } else {
      if (g.value < yMin || g.value > yMax) continue
      parts.push(`<line x1="${plot.x}" y1="${fmt(py(g.value))}" x2="${plot.x + plot.w}" y2="${fmt(py(g.value))}" stroke="${color}" stroke-width="2.5" stroke-dasharray="12 10"/>`)
      if (g.label) parts.push(`<text x="${plot.x + plot.w - 12}" y="${fmt(py(g.value) - 12)}" fill="${color}" font-size="26" text-anchor="end" ${font}>${xmlEscape(g.label)}</text>`)
    }
  }

  /* Curves: a new path segment after every undefined point and across
   * vertical asymptotes (one sample far above the view, the next far below). */
  const span = yMax - yMin
  const limitLo = yMin - span * 4
  const limitHi = yMax + span * 4
  curves.forEach((curve, index) => {
    const color = theme.curveColors[index % theme.curveColors.length] as string
    let d = ''
    let previous: number | null = null
    for (const [x, y] of curve.samples) {
      if (!Number.isFinite(y)) {
        previous = null
        continue
      }
      const jumps = previous !== null && ((previous > yMax && y < yMin) || (previous < yMin && y > yMax))
      const clamped = Math.min(limitHi, Math.max(limitLo, y))
      d += `${previous === null || jumps ? 'M' : 'L'}${fmt(px(x))} ${fmt(py(clamped))}`
      previous = y
    }
    if (d) parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" clip-path="url(#plot-area)"/>`)
  })

  /* Marked points: open circles are holes (the value is not defined there). */
  for (const p of spec.points) {
    if (p.x < xMin || p.x > xMax || p.y < yMin || p.y > yMax) continue
    const color = theme.curveColors[0] as string
    parts.push(
      p.open
        ? `<circle cx="${fmt(px(p.x))}" cy="${fmt(py(p.y))}" r="11" fill="${theme.background}" stroke="${color}" stroke-width="4"/>`
        : `<circle cx="${fmt(px(p.x))}" cy="${fmt(py(p.y))}" r="10" fill="${color}"/>`
    )
    if (p.label) {
      const right = px(p.x) < plot.x + plot.w * 0.8
      parts.push(`<text x="${fmt(px(p.x) + (right ? 20 : -20))}" y="${fmt(py(p.y) - 18)}" fill="${theme.text}" font-size="26" text-anchor="${right ? 'start' : 'end'}" ${font}>${xmlEscape(p.label)}</text>`)
    }
  }

  /* Legend (top right) when any curve has a label. */
  const labelled = curves.map((c, i) => ({ label: c.label, color: theme.curveColors[i % theme.curveColors.length] as string })).filter((c) => c.label)
  if (labelled.length > 0) {
    const rowH = 40
    const boxW = Math.min(plot.w * 0.6, 60 + Math.max(...labelled.map((c) => (c.label as string).length)) * 15)
    const boxX = plot.x + plot.w - boxW - 16
    const boxY = plot.y + 16
    parts.push(`<rect x="${fmt(boxX)}" y="${boxY}" width="${fmt(boxW)}" height="${labelled.length * rowH + 16}" rx="12" fill="${theme.background}" fill-opacity="0.85" stroke="${theme.grid}"/>`)
    labelled.forEach((c, i) => {
      const y = boxY + 8 + rowH * i + rowH / 2
      parts.push(`<line x1="${fmt(boxX + 16)}" y1="${y}" x2="${fmt(boxX + 46)}" y2="${y}" stroke="${c.color}" stroke-width="5" stroke-linecap="round"/>`)
      parts.push(`<text x="${fmt(boxX + 58)}" y="${y + 9}" fill="${theme.text}" font-size="24" ${font}>${xmlEscape(c.label as string)}</text>`)
    })
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${parts.join('')}</svg>`
}
