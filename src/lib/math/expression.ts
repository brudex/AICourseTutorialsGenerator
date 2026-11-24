/**
 * SOURCE OF TRUTH KEYWORDS: compileExpression, math expression parser,
 *   function of x, GRAPH scene curve, safe expression evaluator
 *
 * WHAT:  Parses a model-written formula in x ("(x^2 - 4)/(x - 2)",
 *        "sin(x)/x", "2x + 1", "e^(-x^2)") into a function of x.
 *        Supports + - * / ^ (and ** as ^), unary minus, parentheses, implicit
 *        multiplication (2x, 3(x+1), (x+1)(x-1)), the constants pi and e,
 *        and sin cos tan asin acos atan sinh cosh tanh sqrt cbrt abs exp ln
 *        log (base 10) log2 floor ceil round sign.
 * WHY:   GRAPH scenes draw curves the way a plotting script would, without
 *        running model-written code: a tiny parser that only knows arithmetic
 *        cannot do anything but compute numbers. Undefined points (0/0, sqrt
 *        of a negative) come back as NaN so the plot leaves a gap there.
 * WHERE: sceneSchema (rejects formulas that do not parse, so the model's
 *        repair turn fixes them) and src/lib/math/graph.ts (draws them).
 *        Client-safe.
 */

export type CompiledExpression = (x: number) => number

type Node =
  | { kind: 'num'; value: number }
  | { kind: 'x' }
  | { kind: 'neg'; arg: Node }
  | { kind: 'bin'; op: '+' | '-' | '*' | '/' | '^'; left: Node; right: Node }
  | { kind: 'call'; fn: (v: number) => number; arg: Node }

const FUNCTIONS: Record<string, (v: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  exp: Math.exp,
  ln: Math.log,
  log: Math.log10,
  log10: Math.log10,
  log2: Math.log2,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  sign: Math.sign,
}

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E }

type Token = { type: 'num'; value: number } | { type: 'id'; value: string } | { type: 'op'; value: string }

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  const text = source.replace(/\*\*/g, '^').replace(/[·×]/g, '*').replace(/−/g, '-').replace(/π/g, 'pi')
  let i = 0
  while (i < text.length) {
    const ch = text[i] as string
    if (/\s/.test(ch)) {
      i++
    } else if (/[0-9.]/.test(ch)) {
      const match = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(text.slice(i))
      if (!match) throw new Error(`Bad number at "${text.slice(i, i + 8)}"`)
      tokens.push({ type: 'num', value: Number(match[0]) })
      i += match[0].length
    } else if (/[a-zA-Z_]/.test(ch)) {
      const match = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(text.slice(i)) as RegExpExecArray
      tokens.push({ type: 'id', value: match[0].toLowerCase() })
      i += match[0].length
    } else if ('+-*/^()'.includes(ch)) {
      tokens.push({ type: 'op', value: ch })
      i++
    } else {
      throw new Error(`Unexpected "${ch}"`)
    }
  }
  return tokens
}

/* Splits identifiers like "xsin" or "pix" that a model may run together
 * into known names; anything left over is an error. */
function splitIdentifier(id: string): string[] {
  if (id === 'x' || id in FUNCTIONS || id in CONSTANTS) return [id]
  const names = ['x', ...Object.keys(FUNCTIONS), ...Object.keys(CONSTANTS)].sort((a, b) => b.length - a.length)
  const parts: string[] = []
  let rest = id
  while (rest.length > 0) {
    const name = names.find((n) => rest.startsWith(n))
    if (!name) throw new Error(`Unknown name "${id}". Use x, pi, e and standard functions such as sin, sqrt, ln.`)
    parts.push(name)
    rest = rest.slice(name.length)
  }
  return parts
}

class Parser {
  private tokens: Token[]
  private pos = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens.flatMap((t): Token[] => (t.type === 'id' ? splitIdentifier(t.value).map((value) => ({ type: 'id' as const, value })) : [t]))
  }

  parse(): Node {
    if (this.tokens.length === 0) throw new Error('Empty formula')
    const node = this.expression()
    if (this.pos < this.tokens.length) throw new Error(`Unexpected "${this.describe(this.tokens[this.pos])}"`)
    return node
  }

  private describe(token: Token | undefined): string {
    return token ? String(token.value) : 'end'
  }

  private peekOp(value: string): boolean {
    const t = this.tokens[this.pos]
    return t?.type === 'op' && t.value === value
  }

  private expression(): Node {
    let node = this.term()
    while (this.peekOp('+') || this.peekOp('-')) {
      const op = (this.tokens[this.pos++] as Token).value as '+' | '-'
      node = { kind: 'bin', op, left: node, right: this.term() }
    }
    return node
  }

  /* Starts an implicit product: a number, a name or an opening bracket. */
  private startsFactor(): boolean {
    const t = this.tokens[this.pos]
    return !!t && (t.type === 'num' || t.type === 'id' || (t.type === 'op' && t.value === '('))
  }

  private term(): Node {
    let node = this.unary()
    for (;;) {
      if (this.peekOp('*') || this.peekOp('/')) {
        const op = (this.tokens[this.pos++] as Token).value as '*' | '/'
        node = { kind: 'bin', op, left: node, right: this.unary() }
      } else if (this.startsFactor()) {
        node = { kind: 'bin', op: '*', left: node, right: this.power() }
      } else {
        return node
      }
    }
  }

  private unary(): Node {
    if (this.peekOp('-')) {
      this.pos++
      return { kind: 'neg', arg: this.unary() }
    }
    if (this.peekOp('+')) {
      this.pos++
      return this.unary()
    }
    return this.power()
  }

  /* Right associative, and binds tighter than unary minus: -x^2 = -(x^2). */
  private power(): Node {
    const base = this.primary()
    if (this.peekOp('^')) {
      this.pos++
      return { kind: 'bin', op: '^', left: base, right: this.unary() }
    }
    return base
  }

  private primary(): Node {
    const t = this.tokens[this.pos++]
    if (!t) throw new Error('The formula ends too early')
    if (t.type === 'num') return { kind: 'num', value: t.value }
    if (t.type === 'op' && t.value === '(') {
      const inner = this.expression()
      if (!this.peekOp(')')) throw new Error('Missing ")"')
      this.pos++
      return inner
    }
    if (t.type === 'id') {
      if (t.value === 'x') return { kind: 'x' }
      if (t.value in CONSTANTS) return { kind: 'num', value: CONSTANTS[t.value] as number }
      const fn = FUNCTIONS[t.value]
      if (fn) {
        /* sin(x)^2 squares the sine; sin x and sin 2x take the next power as the argument. */
        return { kind: 'call', fn, arg: this.peekOp('(') ? this.primary() : this.power() }
      }
    }
    throw new Error(`Unexpected "${this.describe(t)}"`)
  }
}

function evaluate(node: Node, x: number): number {
  switch (node.kind) {
    case 'num':
      return node.value
    case 'x':
      return x
    case 'neg':
      return -evaluate(node.arg, x)
    case 'call':
      return node.fn(evaluate(node.arg, x))
    case 'bin': {
      const a = evaluate(node.left, x)
      const b = evaluate(node.right, x)
      switch (node.op) {
        case '+':
          return a + b
        case '-':
          return a - b
        case '*':
          return a * b
        case '/':
          return b === 0 ? NaN : a / b
        case '^':
          /* Odd roots of negatives, e.g. x^(1/3), are real. */
          if (a < 0 && !Number.isInteger(b)) {
            const inverse = 1 / b
            return Number.isInteger(Math.round(inverse)) && Math.abs(inverse - Math.round(inverse)) < 1e-9 && Math.round(inverse) % 2 !== 0
              ? -Math.pow(-a, b)
              : NaN
          }
          return Math.pow(a, b)
      }
    }
  }
}

/** Compiles `source` (a formula in x, optionally written "y = …" or "f(x) = …"). Throws with a readable message. */
export function compileExpression(source: string): CompiledExpression {
  const formula = source.replace(/^\s*(?:y|[a-z]\s*\(\s*x\s*\))\s*=/i, '')
  const tree = new Parser(tokenize(formula)).parse()
  return (x: number) => {
    const y = evaluate(tree, x)
    return Number.isFinite(y) ? y : NaN
  }
}

/** null when `source` parses, else why not. */
export function expressionError(source: string): string | null {
  try {
    compileExpression(source)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'Invalid formula'
  }
}
