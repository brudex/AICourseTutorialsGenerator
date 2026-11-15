import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: assertProviderUrlAllowed, SSRF guard,
 *   AI_ALLOW_PRIVATE_BASE_URLS, private network, blocked_url
 *
 * WHAT:  Refuses provider base URLs that resolve to private, loopback,
 *        link-local, or metadata addresses — unless private URLs are allowed.
 * WHY:   Base URLs are user input and the SERVER fetches them, which is a
 *        classic SSRF vector (e.g. 169.254.169.254 cloud metadata). Checked at
 *        call time, not just on save, because DNS can change afterwards.
 *        Private URLs are allowed outside production (local Ollama during dev)
 *        and when AI_ALLOW_PRIVATE_BASE_URLS="true" (self-hosted installs).
 * WHERE: Called by src/lib/ai/adapters/openai-compatible.ts before every
 *        request, including testConnection.
 */

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

import { AiGatewayError } from './errors'

function privateUrlsAllowed(): boolean {
  return (
    process.env['AI_ALLOW_PRIVATE_BASE_URLS'] === 'true' || process.env['NODE_ENV'] !== 'production'
  )
}

function isPrivateIPv4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  )
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  if (normalized === '::' || normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) return isPrivateIPv4(normalized.slice(7))
  return /^(fc|fd|fe8|fe9|fea|feb)/.test(normalized)
}

function isPrivateAddress(ip: string): boolean {
  return isIP(ip) === 6 ? isPrivateIPv6(ip) : isPrivateIPv4(ip)
}

export async function assertProviderUrlAllowed(baseUrl: string): Promise<void> {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new AiGatewayError('blocked_url', 'The provider base URL is not a valid URL.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AiGatewayError('blocked_url', 'The provider base URL must use http or https.')
  }
  if (privateUrlsAllowed()) return

  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true }).then(
        (results) => results.map((r) => r.address),
        () => {
          throw new AiGatewayError('network', `Could not resolve ${host}.`)
        }
      )
  if (addresses.some(isPrivateAddress)) {
    throw new AiGatewayError(
      'blocked_url',
      'This base URL points at a private network address, which is not allowed on this server.'
    )
  }
}
