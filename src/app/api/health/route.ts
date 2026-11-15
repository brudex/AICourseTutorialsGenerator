/**
 * SOURCE OF TRUTH KEYWORDS: healthRoute, GET /api/health, health check,
 *   uptime probe, load balancer check, database ping
 *
 * WHAT:  Answers 200 {"ok":true} when the web server is up and the database
 *        answers, 503 otherwise.
 * WHY:   Hosts (Docker, Railway, Render, Fly, a load balancer) restart or stop
 *        routing to an instance that fails this, so a lost database shows up
 *        as an unhealthy app instead of silent errors. Says nothing else
 *        about the install.
 * WHERE: Dockerfile HEALTHCHECK, docker-compose.yml, the host's probe.
 */

import { NextResponse } from 'next/server'

import { prisma } from '@/lib/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 })
  }
}
