/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: apiLimiter, authLimiter, getResourceLimiter,
 *   checkRateLimit, buildRateLimitHeaders, getClientIp, RateLimitResult,
 *   RateLimiterSpec
 *
 * WHAT:  Upstash-backed rate limiter factories, the global limiter checker,
 *        standard `RateLimit-*` header builder, and the trusted-edge client-IP
 *        resolver.
 * WHY:   Redis is OPTIONAL (portal settings → Security) — when unconfigured
 *        checkRateLimit fails open; rate limiting is a guardrail, not the only
 *        line of defense, and refusing all traffic on a Redis outage is almost
 *        always worse than letting more requests through.
 * WHERE: Consumed by src/proxy.ts (apiLimiter, authLimiter), procedure factory
 *        for per-resource overrides via RESOURCES[x].rateLimit, and
 *        src/lib/request-forensics.ts (getClientIp).
 */

/* Upstash-backed rate limiting. Redis is OPTIONAL — when unconfigured
 * checkRateLimit fails open. Rate limiting is a guardrail,
 * not the only line of defense; refusing all traffic on a Redis outage is
 * almost always worse than letting more requests through. */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

import { platformSettingText } from '@/lib/platform-settings'
import type { RateLimiterCache, RateLimiterSpec, RateLimitWindow } from '@/lib/types'

/**
 * SOURCE OF TRUTH KEYWORDS: RateLimiterSpec, defineLimiter, resolveLimiter,
 *   upstashRedisRestUrl, upstashRedisRestToken, hot reload rate limit
 *
 * WHAT:  A limiter is declared as a spec (prefix, count, window) and turned
 *        into an Upstash Ratelimit only when checked.
 * WHY:   The Redis URL and token are portal settings, so they can change while
 *        the app runs. Resolving at check time against a client cached by
 *        URL + token means turning rate limiting on, off or onto a new database
 *        applies without a restart. Missing settings resolve to null → fail open.
 * WHERE: checkRateLimit below; specs exported as apiLimiter, authLimiter and
 *        getResourceLimiter.
 */
const GLOBAL_LIMITERS_KEY = Symbol.for('app.upstash.limiters')

type GlobalWithLimiters = typeof globalThis & {
  [GLOBAL_LIMITERS_KEY]?: RateLimiterCache
}

function limiterCache(): RateLimiterCache {
  const holder = globalThis as GlobalWithLimiters
  const url = platformSettingText('upstashRedisRestUrl')
  const token = platformSettingText('upstashRedisRestToken')
  const fingerprint = `${url}\n${token}`
  if (holder[GLOBAL_LIMITERS_KEY]?.fingerprint !== fingerprint) {
    holder[GLOBAL_LIMITERS_KEY] = {
      fingerprint,
      redis: url && token ? new Redis({ url, token }) : null,
      limiters: new Map(),
    }
  }
  return holder[GLOBAL_LIMITERS_KEY]
}

function resolveLimiter(spec: RateLimiterSpec): Ratelimit | null {
  const cache = limiterCache()
  if (!cache.redis) return null
  const cacheKey = `${spec.prefix}:${spec.count}:${spec.window}`
  let limiter = cache.limiters.get(cacheKey)
  if (!limiter) {
    limiter = new Ratelimit({
      redis: cache.redis,
      limiter: Ratelimit.slidingWindow(spec.count, spec.window),
      prefix: spec.prefix,
      analytics: false,
    })
    cache.limiters.set(cacheKey, limiter)
  }
  return limiter
}

function defineLimiter(prefix: string, count: number, window: RateLimitWindow): RateLimiterSpec {
  return { prefix, count, window }
}

/**
 * SOURCE OF TRUTH KEYWORDS: apiLimiter
 *
 * WHAT:  Global API rate limiter (100 / 10s sliding window).
 * WHY:   Per-IP cap for general API traffic — broad guardrail, not a per-route
 *        check; per-resource overrides live on RESOURCES[x].rateLimit.
 * WHERE: tRPC route handler and baseProcedure.
 */
export const apiLimiter = defineLimiter('rl:api', 100, '10 s')

/**
 * SOURCE OF TRUTH KEYWORDS: authLimiter
 *
 * WHAT:  Tight IP-keyed rate limiter (10 / 60s) for auth endpoints.
 * WHY:   Brute-force and credential-stuffing protection — far stricter than
 *        the general apiLimiter.
 * WHERE: src/app/api/auth/[...all]/route.ts.
 */
export const authLimiter = defineLimiter('rl:auth', 10, '60 s')

/**
 * SOURCE OF TRUTH KEYWORDS: getResourceLimiter
 *
 * WHAT:  The limiter spec for one resource/action override.
 * WHY:   Lets RESOURCES[x].rateLimit overrides materialise into distinct
 *        Upstash keys; the Ratelimit itself is built and cached on first check.
 * WHERE: Called by protectedProcedure when a RESOURCES rateLimit override matches.
 */
export function getResourceLimiter(
  resource: string,
  action: string,
  count: number,
  window: RateLimitWindow
): RateLimiterSpec {
  return defineLimiter(`rl:res:${resource}.${action}`, count, window)
}

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  resetAt: number
}

/**
 * SOURCE OF TRUTH KEYWORDS: checkRateLimit, RateLimitResult
 *
 * WHAT:  Runs a limiter against an identifier, returning a structured result.
 * WHY:   Fails open when Redis is not configured or throws — rate limiting is a
 *        guardrail, not authentication; refusing traffic on Redis outage is
 *        almost always worse than letting it through.
 * WHERE: Used by src/proxy.ts and the per-procedure rate-limit path.
 */
export async function checkRateLimit(
  spec: RateLimiterSpec,
  identifier: string
): Promise<RateLimitResult> {
  const limiter = resolveLimiter(spec)
  if (!limiter) {
    return { allowed: true, limit: 0, remaining: 0, resetAt: 0 }
  }
  try {
    const result = await limiter.limit(identifier)
    return {
      allowed: result.success,
      limit: result.limit,
      remaining: result.remaining,
      resetAt: result.reset,
    }
  } catch (error) {
    console.error('[rate-limit] Redis check failed, failing open:', error)
    return { allowed: true, limit: 0, remaining: 0, resetAt: 0 }
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: buildRateLimitHeaders
 *
 * WHAT:  Builds the IETF-draft `RateLimit-*` headers (plus `Retry-After` when
 *        the request was blocked).
 * WHY:   Centralises header naming so every gate (proxy, tRPC) emits the same
 *        wire format clients can rely on.
 * WHERE: Used by src/proxy.ts and the tRPC error path.
 */
export function buildRateLimitHeaders(
  result: RateLimitResult
): Record<string, string> {
  return {
    'RateLimit-Limit': String(result.limit),
    'RateLimit-Remaining': String(result.remaining),
    'RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
    ...(result.allowed
      ? {}
      : {
          'Retry-After': String(
            Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000))
          ),
        }),
  }
}

/**
 * SOURCE OF TRUTH KEYWORDS: getClientIp
 *
 * WHAT:  Resolves the best-available client IP from request headers.
 * WHY:   Platform headers (x-vercel-forwarded-for, cf-connecting-ip, x-real-ip)
 *        are trustworthy because the edge rewrites them on ingress; the XFF
 *        "last entry" fallback is only safe when the edge strips inbound
 *        client-supplied XFF — treat as a hint, never for auth decisions.
 * WHERE: Used by rate-limit identifiers and src/lib/request-forensics.ts.
 */
/* Client IP precedence: platform headers (Vercel, Cloudflare) are trustworthy
 * because the edge rewrites them on ingress. XFF "last entry" is only safe
 * when the edge strips inbound client-supplied XFF — treat as a hint, never
 * for auth decisions. */
export function getClientIp(headers: Headers): string | null {
  const vercel = headers.get('x-vercel-forwarded-for')
  if (vercel) {
    const ip = vercel.split(',')[0]?.trim()
    if (ip) return ip
  }

  const cloudflare = headers.get('cf-connecting-ip')
  if (cloudflare) {
    const ip = cloudflare.trim()
    if (ip) return ip
  }

  const realIp = headers.get('x-real-ip')
  if (realIp) {
    const ip = realIp.trim()
    if (ip) return ip
  }

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded.split(',')
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = parts[i]?.trim()
      if (candidate) return candidate
    }
  }

  return null
}
