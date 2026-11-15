/**
 * SOURCE OF TRUTH KEYWORDS: normalizeMermaid, Mermaid cleanup, diagram
 *   normalisation, one-line Mermaid, quote node labels, strip style lines
 *
 * WHAT:  Repairs the Mermaid mistakes models make most, before the parser
 *        sees the source:
 *          - escaped newlines ("\n" as text) become real line breaks;
 *          - statements written on one line, separated by `;`, `<br>` or
 *            only a space, are split onto their own lines (labels are left
 *            alone);
 *          - the `flowchart TD` / `graph LR` header gets its own line;
 *          - `style`, `classDef`, `class`, `linkStyle` and `click` lines and `:::name`
 *            class suffixes are removed (the slide theme styles diagrams, and
 *            invented style syntax was the second most common failure);
 *          - flowchart labels in [..] and |..| that contain characters Mermaid
 *            treats as syntax (brackets, parentheses, quotes, <br>) are quoted.
 * WHY:   In production runs a third of diagrams failed to parse, almost all
 *        for these reasons, and the model repair loop often failed the same
 *        way. Fixing them deterministically is instant, free and reliable;
 *        the repair loop still handles anything else.
 * WHERE: renderDiagram in the Visual Renderer (src/lib/agents/visual-renderer.ts).
 */

const FLOWCHART_HEADER = /^\s*(flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i
const STYLE_LINE = /^\s*(style|classDef|class|linkStyle|click)\s/i
/* A new statement starting after a finished node: `B C --> D`, `A[x] subgraph S`. */
const NEXT_STATEMENT = /^\s+(?=(?:subgraph|end|click|style|classDef|class|linkStyle)\b|[A-Za-z0-9_]+\s*(?:\[|\(|\{|-->|---|-\.->|==>|<--|-\.-|&))/
const ENDS_WITH_EDGE = /(-->|---|-\.->|==>|<--|-\.-|&|\|)\s*$/

/* Splits on `;` and `<br>` only outside [ ] ( ) { } | | and quotes. */
function splitStatements(line: string): string[] {
  const out: string[] = []
  let depth = 0
  let inQuote = false
  let inPipe = false
  let current = ''
  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? ''
    if (ch === '"') inQuote = !inQuote
    else if (!inQuote && ch === '|') inPipe = !inPipe
    else if (!inQuote && !inPipe && '[({'.includes(ch)) depth++
    else if (!inQuote && !inPipe && '])}'.includes(ch)) depth = Math.max(0, depth - 1)

    const free = depth === 0 && !inQuote && !inPipe
    /* Statements written side by side with only a space between them. */
    if (free && /\s/.test(ch) && current.trim() && !/^subgraph$/i.test(current.trim()) && !ENDS_WITH_EDGE.test(current) && NEXT_STATEMENT.test(line.slice(i))) {
      out.push(current)
      current = ''
      continue
    }
    if (free && ch === ';') {
      out.push(current)
      current = ''
      continue
    }
    const br = /^<br\s*\/?>/i.exec(line.slice(i))
    if (free && br) {
      out.push(current)
      current = ''
      i += br[0].length - 1
      continue
    }
    current += ch
  }
  out.push(current)
  return out.map((s) => s.trim()).filter(Boolean)
}

const NEEDS_QUOTES = /[()[\]{}<>"#;:&]/

/* id[label] → id["label"] and -->|label| → -->|"label"| when the label holds
 * syntax characters. Already quoted labels are kept. */
function quoteFlowchartLabels(line: string): string {
  const quoted = line.replace(/([A-Za-z0-9_-]+)\[(?!")((?:[^\[\]]|\[[^\[\]]*\])*)\](?!\])/g, (whole, id: string, label: string) =>
    NEEDS_QUOTES.test(label) ? `${id}["${label.replace(/"/g, "'")}"]` : whole
  )
  return quoted.replace(/\|(?!")([^|]+)\|/g, (whole, label: string) =>
    NEEDS_QUOTES.test(label) ? `|"${label.replace(/"/g, "'")}"|` : whole
  )
}

export function normalizeMermaid(source: string): string {
  let text = source.replace(/\r\n?/g, '\n').replace(/\\n/g, '\n').trim()
  /* Strip a Markdown code fence if the model wrapped the diagram in one. */
  text = text.replace(/^```(?:mermaid)?\s*\n?/i, '').replace(/\n?```\s*$/, '')

  const isFlowchart = FLOWCHART_HEADER.test(text)
  const lines: string[] = []
  for (const rawLine of text.split('\n')) {
    let line = rawLine
    const header = isFlowchart ? FLOWCHART_HEADER.exec(line) : null
    if (header && header.index === line.search(/\S/)) {
      lines.push(`${header[1]} ${header[2]}`)
      line = line.slice(header.index + header[0].length)
    }
    const statements = isFlowchart ? splitStatements(line) : [line.trimEnd()]
    for (const statement of statements) {
      if (STYLE_LINE.test(statement)) continue
      /* An unnamed subgraph crashes the renderer; give it a blank title. */
      const named = /^subgraph$/i.test(statement.trim()) ? `subgraph group${lines.length}[" "]` : statement
      const cleaned = named.replace(/:::[A-Za-z0-9_-]+/g, '')
      lines.push(isFlowchart ? `  ${quoteFlowchartLabels(cleaned.trim())}` : cleaned)
    }
  }
  return lines.filter((line) => line.trim().length > 0).join('\n')
}
