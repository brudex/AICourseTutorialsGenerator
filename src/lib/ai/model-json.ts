/**
 * SOURCE OF TRUTH KEYWORDS: parseModelJson, repairJsonText,
 *   normalizeCodeFields, CODE_FIELD_KEYS, lenient JSON, raw newline in JSON
 *   string, escaped code newlines, structured output repair
 *
 * WHAT:  Reads the JSON a model returned, forgiving the two mistakes models
 *        make most with code inside JSON:
 *        1. Raw line breaks, tabs or stray backslashes inside strings (code
 *           pasted as-is: `"code": "a\n  b"` with a real newline, or a regex
 *           `\d`). JSON.parse rejects these; repairJsonText escapes them.
 *        2. Code written as ONE line with the two characters `\n` where the
 *           line breaks should be (double escaped). The code then has one
 *           line, so highlight steps for lines 2+ fail validation. Code fields
 *           with no real line break but literal `\n` sequences are unescaped.
 * WHY:   Both failed whole agent steps (Exercise Designer "not valid JSON",
 *        Video Director "the code has 1 lines") even after a repair turn,
 *        because the model repeats the same formatting. Fixing them
 *        deterministically is cheaper and more reliable than another call.
 *        Only syntax is repaired; the schema still validates the content.
 * WHERE: parseStructured in src/lib/ai/gateway.ts (every structured call).
 */

/* Fields that hold source code in the course content schemas. */
const CODE_FIELD_KEYS: ReadonlySet<string> = new Set([
  'code',
  'initialCode',
  'typedCode',
  'starterCode',
  'solution',
  'referenceSolution',
  'content',
])

const VALID_ESCAPES: ReadonlySet<string> = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u'])

/** Escapes control characters and invalid backslashes inside JSON strings. */
export function repairJsonText(text: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? ''
    if (!inString) {
      if (char === '"') inString = true
      out += char
      continue
    }
    if (char === '\\') {
      const next = text[i + 1] ?? ''
      if (VALID_ESCAPES.has(next)) {
        out += char + next
        i++
      } else {
        out += '\\\\'
      }
      continue
    }
    if (char === '"') {
      inString = false
      out += char
      continue
    }
    const code = char.charCodeAt(0)
    if (char === '\n') out += '\\n'
    else if (char === '\r') out += '\\r'
    else if (char === '\t') out += '\\t'
    else if (code < 0x20) out += `\\u${code.toString(16).padStart(4, '0')}`
    else out += char
  }
  return out
}

/* One-line code with literal "\n" sequences becomes real multi-line code. */
function unescapeFlatCode(value: string): string {
  if (value.includes('\n') || !value.includes('\\n')) return value
  return value.replace(/\\r\\n|\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"')
}

/** Walks the parsed reply and repairs flattened code fields in place of copies. */
export function normalizeCodeFields(value: unknown, key: string | null = null): unknown {
  if (typeof value === 'string') return key !== null && CODE_FIELD_KEYS.has(key) ? unescapeFlatCode(value) : value
  if (Array.isArray(value)) return value.map((item) => normalizeCodeFields(item, key))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeCodeFields(v, k)]))
  }
  return value
}

/** JSON.parse, then a repaired parse; null when neither works. */
export function parseModelJson(text: string): { ok: true; value: unknown } | { ok: false } {
  for (const candidate of [text, repairJsonText(text)]) {
    try {
      return { ok: true, value: normalizeCodeFields(JSON.parse(candidate)) }
    } catch {
      /* try the next candidate */
    }
  }
  return { ok: false }
}
