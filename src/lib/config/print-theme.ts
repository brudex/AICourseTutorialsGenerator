/**
 * SOURCE OF TRUTH KEYWORDS: PRINT_THEME, PDF theme, print styles, document
 *   colours, workbook design
 *
 * WHAT:  Paper design tokens for every generated PDF (workbook, answer key,
 *        cheat sheet, glossary): page size, margins, colours, fonts and the
 *        light Shiki theme for code.
 * WHY:   PDFs are printed and read on white paper, so they use their own light
 *        palette instead of the app's (possibly dark) UI theme. Rebranding
 *        every download is a change here only, the same way SLIDE_THEME owns
 *        the lecture video look.
 * WHERE: src/lib/render/documents.ts (PDFs) and scorm-player.ts (the SCORM
 *        player uses the same light palette).
 */

export const PRINT_THEME = {
  pageFormat: 'A4',
  margin: { top: '18mm', bottom: '20mm', left: '16mm', right: '16mm' },
  ink: '#16181d',
  muted: '#5b6170',
  rule: '#e3e5ea',
  panel: '#f6f7f9',
  accent: '#4f46e5',
  accentSoft: '#eef0ff',
  success: '#15803d',
  successSoft: '#e8f6ec',
  danger: '#b42318',
  dangerSoft: '#fdecec',
  paper: '#ffffff',
  onAccent: '#ffffff',
  videoBackdrop: '#000000',
  fontSans: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  fontMono: "'JetBrains Mono', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  codeTheme: 'github-light',
} as const
