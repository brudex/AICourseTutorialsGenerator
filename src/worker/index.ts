import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: generation worker, workerLoop, workerConcurrency,
 *   workerPollIntervalMs, graceful shutdown, stale task sweep, npm run worker
 *
 * WHAT:  The long-running process that executes generation tasks:
 *        poll → claim READY tasks (SKIP LOCKED) → run up to N concurrently →
 *        repeat; a periodic sweep recovers tasks a crashed worker left RUNNING.
 * WHY:   Model calls take seconds to minutes, so they cannot run inside web
 *        requests (spec §2). Several worker processes may run at once — the
 *        claim is atomic. On SIGINT/SIGTERM it stops claiming, lets in-flight
 *        tasks finish (up to SHUTDOWN_GRACE_MS), then exits; anything still
 *        running is recovered by the next worker's stale sweep.
 *        Started with `npm run worker` (tsx with the react-server condition so
 *        `import 'server-only'` resolves to its no-op build outside Next).
 * WHERE: Run alongside `npm run dev` / `next start`.
 */

import { hostname } from 'node:os'
import { randomUUID } from 'node:crypto'

import { prisma } from '@/lib/config'
import { recoverStaleTasks } from '@/lib/generation'
import { platformSettingNumber } from '@/lib/platform-settings'
import { ensurePlatformSettings } from '@/lib/platform-settings/loader'
import { closeRenderBrowser } from '@/lib/render'
import * as generationService from '@/services/generation.service'
import { runClaimedTask } from './run-task'

/* Read every loop turn from portal settings (Background worker), so a new
 * concurrency or poll interval applies without restarting the worker. */
const concurrency = () => platformSettingNumber('workerConcurrency')
const pollIntervalMs = () => platformSettingNumber('workerPollIntervalMs')
/* Longer than the slowest legitimate task: a 12,000 token answer may take
 * five minutes per call, and a repair turn doubles that. Reclaiming sooner
 * would run a live task twice. */
const STALE_AFTER_SECONDS = 30 * 60
const SWEEP_INTERVAL_MS = 60_000
const SHUTDOWN_GRACE_MS = 30_000

const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`
const inFlight = new Set<Promise<void>>()
let stopping = false

function log(line: string): void {
  console.log(`[worker ${new Date().toISOString()}] ${line}`)
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function sweep(): Promise<void> {
  try {
    const { requeued, failed } = await recoverStaleTasks(STALE_AFTER_SECONDS)
    if (requeued + failed > 0) log(`recovered stale tasks: ${requeued} requeued, ${failed} failed`)
  } catch (error) {
    log(`stale sweep failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/* ORPHAN_RECOVERY: tasks still locked by a worker process on this host that
 * no longer exists are expired now, so the first sweep requeues them instead
 * of waiting STALE_AFTER_SECONDS. Worker ids are host:pid:random. */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM'
  }
}

async function releaseOrphanedTasks(): Promise<void> {
  try {
    const locks = await generationService.listRunningTaskLocks(prisma, `${hostname()}:`)
    const orphaned = locks.filter((lock) => {
      const pid = Number.parseInt(lock.lockedBy?.split(':')[1] ?? '', 10)
      return Number.isFinite(pid) && pid !== process.pid && !isProcessAlive(pid)
    })
    if (orphaned.length === 0) return
    await generationService.expireTaskLocks(prisma, orphaned.map((lock) => lock.id))
    log(`released ${orphaned.length} task(s) left running by a stopped worker`)
  } catch (error) {
    log(`orphan release failed: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function loop(): Promise<void> {
  await ensurePlatformSettings()
  log(`started ${workerId} — concurrency ${concurrency()}, poll ${pollIntervalMs()}ms`)
  await releaseOrphanedTasks()
  let lastSweep = 0
  while (!stopping) {
    if (Date.now() - lastSweep > SWEEP_INTERVAL_MS) {
      lastSweep = Date.now()
      await sweep()
    }

    let claimed: string[] = []
    try {
      claimed = await generationService.claimReadyTasks(prisma, workerId, Math.max(0, concurrency() - inFlight.size))
    } catch (error) {
      log(`claim failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    for (const taskId of claimed) {
      const run = runClaimedTask(taskId, log).finally(() => inFlight.delete(run))
      inFlight.add(run)
    }

    /* Idle or saturated → wait; otherwise loop straight back for more work. */
    if (claimed.length === 0 || inFlight.size >= concurrency()) {
      await Promise.race([sleep(pollIntervalMs()), ...inFlight])
    }
  }
}

async function shutdown(signal: string): Promise<void> {
  if (stopping) return
  stopping = true
  log(`${signal} received — finishing ${inFlight.size} in-flight task(s)…`)
  await Promise.race([Promise.allSettled([...inFlight]), sleep(SHUTDOWN_GRACE_MS)])
  await closeRenderBrowser()
  await prisma.$disconnect()
  log('stopped')
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

loop().catch(async (error) => {
  log(`fatal: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`)
  await prisma.$disconnect()
  process.exit(1)
})
