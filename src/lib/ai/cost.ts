/**
 * SOURCE OF TRUTH KEYWORDS: calculateCostMicros, costMicros, micro-USD,
 *   formatCostMicros, token pricing
 *
 * WHAT:  Converts token counts × per-million-token prices into integer
 *        micro-USD, and formats micro-USD for display.
 * WHY:   Money is stored as BigInt micro-dollars (1 USD = 1,000,000) so summing
 *        thousands of small calls never drifts the way floats do. Prices arrive
 *        as plain numbers (USD per 1M tokens), so the per-token rate in
 *        micro-USD is simply `price` — tokens × price gives micro-USD directly.
 *        Pure and client-safe (no server-only), so the UI formats the same way.
 * WHERE: src/lib/ai/gateway.ts (cost of each call); usage + activity UI.
 */

export function calculateCostMicros(params: {
  inputTokens: number
  outputTokens: number
  inputPricePerMTok: number
  outputPricePerMTok: number
}): bigint {
  const micros =
    params.inputTokens * params.inputPricePerMTok + params.outputTokens * params.outputPricePerMTok
  return BigInt(Math.round(micros))
}

export function formatCostMicros(micros: bigint): string {
  const usd = Number(micros) / 1_000_000
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}
