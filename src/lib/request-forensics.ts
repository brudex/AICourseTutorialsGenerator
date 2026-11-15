/*
 * Copyright (c) 2026 Web Prodigies LLC. All rights reserved.
 *
 * This source code is proprietary and confidential. Use, copying,
 * modification or distribution requires a written license from
 * Web Prodigies LLC. See the LICENSE file in the root of this repository.
 */

/**
 * SOURCE OF TRUTH KEYWORDS: getRequestForensics, ForensicData
 *
 * WHAT:  Captures the client IP and user-agent for audit-log forensic fields.
 * WHY:   ipAddress / userAgent are WRITE-ONLY — recorded for incident response
 *        but never returned by service-layer selects (see AUDIT_LOG_SAFE_SELECT).
 * WHERE: Called by the auto-audit path in protectedProcedure; depends on
 *        getClientIp from src/lib/rate-limit.ts.
 */

import 'server-only'
import { headers } from 'next/headers'
import { getClientIp } from '@/lib/rate-limit'

export interface ForensicData {
  ipAddress: string | null
  userAgent: string | null
}

/* Audit-log forensic capture. ipAddress / userAgent are write-only — never
 * returned by service-layer selects (see AUDIT_LOG_SAFE_SELECT). */
export async function getRequestForensics(): Promise<ForensicData> {
  const requestHeaders = await headers()
  const rawUserAgent = requestHeaders.get('user-agent')
  const userAgent = rawUserAgent && rawUserAgent.length > 0 ? rawUserAgent : null
  return {
    ipAddress: getClientIp(requestHeaders),
    userAgent,
  }
}
