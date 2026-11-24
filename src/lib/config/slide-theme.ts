/**
 * SOURCE OF TRUTH KEYWORDS: SLIDE_THEME, SLIDE_SIZE, video slide theme,
 *   rendered still palette, MERMAID_THEME_VARIABLES
 *
 * WHAT:  The visual identity of rendered lecture slides (stills now, video
 *        frames in step 8): canvas size, colours, fonts, and the matching
 *        Mermaid diagram theme.
 * WHY:   Rendered media is a file, not a page — it cannot follow the app's
 *        CSS theme tokens or a viewer's light/dark preference, so it needs one
 *        fixed palette. Keeping every value here (instead of scattered hex in
 *        templates) is the single place to rebrand course videos, and later
 *        the source for per-workspace branding (customBranding flag).
 * WHERE: src/lib/render/* (slide templates, Mermaid renderer).
 */

export const SLIDE_SIZE = { width: 1920, height: 1080 } as const

export const SLIDE_THEME = {
  background: '#0b0b0d',
  surface: '#151518',
  surfaceRaised: '#1d1d21',
  border: '#2c2c32',
  text: '#f5f5f7',
  mutedText: '#a1a1aa',
  accent: '#8b8bf5',
  accentSoft: 'rgba(139, 139, 245, 0.16)',
  success: '#4ade80',
  successSoft: 'rgba(74, 222, 128, 0.12)',
  danger: '#f87171',
  dangerSoft: 'rgba(248, 113, 113, 0.12)',
  codeHighlight: 'rgba(139, 139, 245, 0.18)',
  fontSans: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  fontMono: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  codeTheme: 'github-dark-default',
} as const

/* GRAPH scenes (src/lib/math/graph.ts) in the slide palette. */
export const GRAPH_THEME = {
  background: SLIDE_THEME.background,
  text: SLIDE_THEME.text,
  mutedText: SLIDE_THEME.mutedText,
  grid: SLIDE_THEME.border,
  axis: SLIDE_THEME.mutedText,
  curveColors: ['#60a5fa', SLIDE_THEME.success, '#fbbf24', SLIDE_THEME.danger],
  fontFamily: SLIDE_THEME.fontSans,
} as const

/* Mermaid's "base" theme driven by the slide palette, so diagrams sit on the
 * slide background without a white box. */
export const MERMAID_THEME_VARIABLES = {
  background: 'transparent',
  fontFamily: SLIDE_THEME.fontSans,
  fontSize: '22px',
  primaryColor: SLIDE_THEME.surfaceRaised,
  primaryTextColor: SLIDE_THEME.text,
  primaryBorderColor: SLIDE_THEME.accent,
  secondaryColor: SLIDE_THEME.surface,
  tertiaryColor: SLIDE_THEME.surface,
  lineColor: SLIDE_THEME.mutedText,
  textColor: SLIDE_THEME.text,
  mainBkg: SLIDE_THEME.surfaceRaised,
  nodeBorder: SLIDE_THEME.accent,
  clusterBkg: SLIDE_THEME.surface,
  clusterBorder: SLIDE_THEME.border,
  edgeLabelBackground: SLIDE_THEME.background,
  actorBkg: SLIDE_THEME.surfaceRaised,
  actorBorder: SLIDE_THEME.accent,
  actorTextColor: SLIDE_THEME.text,
  signalColor: SLIDE_THEME.mutedText,
  signalTextColor: SLIDE_THEME.text,
  noteBkgColor: SLIDE_THEME.surface,
  noteTextColor: SLIDE_THEME.text,
} as const
