/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: RateLimiterSpec, RateLimitWindow, RateLimiterCache,
 *   rate limit types, Upstash limiter spec
 *
 * WHAT:  A rate limiter declared as data, and the per-process cache of built
 *        Upstash limiters keyed by the current Redis settings.
 * WHERE: src/lib/rate-limit.ts and its callers (route handlers, procedures).
 */

import type { Ratelimit } from '@upstash/ratelimit'
import type { Redis } from '@upstash/redis'

export type RateLimitWindow = `${number} ${'s' | 'm' | 'h' | 'd'}`

export interface RateLimiterSpec {
  prefix: string
  count: number
  window: RateLimitWindow
}

export interface RateLimiterCache {
  /** Redis URL + token the cached clients were built for. */
  fingerprint: string
  redis: Redis | null
  limiters: Map<string, Ratelimit>
}
