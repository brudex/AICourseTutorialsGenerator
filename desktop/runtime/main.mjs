/**
 * SOURCE OF TRUTH KEYWORDS: desktop runtime, DesktopRuntime, embedded
 *   postgres, local server, sidecar, READY line, desktop secrets, migrations
 *
 * WHAT:  Everything the desktop app runs behind its window, started by the
 *        Tauri shell as a Node sidecar:
 *          1. per-install secrets (auth secret, AI key encryption key), made
 *             once and kept in the app data folder;
 *          2. a private PostgreSQL (embedded-postgres) in the app data folder;
 *          3. the database migrations, applied in order and recorded;
 *          4. the Next.js server (standalone bundle) and the job worker,
 *             both pointed at that database and at local file storage.
 *        When the server answers, it prints `READY <url>` on stdout; the
 *        shell then shows that URL. On shutdown it stops all three.
 * WHY:   Clients run the whole studio on their own machine, so nothing may
 *        depend on a hosted database or on settings they have to type. The
 *        URL is fixed (DESKTOP_PORT) because it is compiled into the client
 *        bundle (NEXT_PUBLIC_APP_URL) and used for auth cookies.
 * WHERE: Packaged by desktop/scripts/bundle.mjs into the app's resources and
 *        launched by desktop/src-tauri/src/main.rs.
 */

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import EmbeddedPostgres from 'embedded-postgres'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/* Must match the URL the client bundle was built with (bundle.mjs). */
const DESKTOP_PORT = 47831
const DB_PORT = 47832
const APP_URL = `http://127.0.0.1:${DESKTOP_PORT}`
const SERVER_DIR = path.join(HERE, '..', 'server')
const MIGRATIONS_DIR = path.join(HERE, '..', 'migrations')
const READY_TIMEOUT_MS = 120_000

const dataDir = process.env.AI_COURSE_DATA_DIR
if (!dataDir) {
  console.error('AI_COURSE_DATA_DIR is not set')
  process.exit(1)
}

const log = (line) => console.log(`[runtime] ${line}`)
const children = []
let postgres = null
let stopping = false

/* The studio URL is fixed, so a busy port is a clear startup error rather
 * than a server that silently fails to bind. */
function assertPortFree(port, purpose) {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', () =>
      reject(new Error(`Port ${port} (${purpose}) is already in use. Quit the other program using it, or another copy of Penrose Studio, and open the app again.`))
    )
    probe.once('listening', () => probe.close(() => resolve()))
    probe.listen(port, '127.0.0.1')
  })
}

/* Secrets are generated on first launch and never leave this machine. */
async function loadSecrets() {
  const file = path.join(dataDir, 'secrets.json')
  if (existsSync(file)) return JSON.parse(await readFile(file, 'utf8'))
  const secrets = {
    authSecret: randomBytes(32).toString('base64'),
    encryptionKey: randomBytes(32).toString('base64'),
    dbPassword: randomBytes(18).toString('base64url'),
  }
  await writeFile(file, JSON.stringify(secrets, null, 2), { mode: 0o600 })
  return secrets
}

async function startDatabase(secrets) {
  const databaseDir = path.join(dataDir, 'postgres')
  const fresh = !existsSync(path.join(databaseDir, 'PG_VERSION'))
  /* After a crash or forced quit PostgreSQL leaves postmaster.pid behind and
   * refuses to start; remove it when that process is gone. */
  const pidFile = path.join(databaseDir, 'postmaster.pid')
  if (existsSync(pidFile)) {
    const pid = Number.parseInt((await readFile(pidFile, 'utf8')).split('\n')[0] ?? '', 10)
    let alive = false
    try {
      process.kill(pid, 0)
      alive = true
    } catch {
      alive = false
    }
    if (!alive) await rm(pidFile, { force: true })
  }
  postgres = new EmbeddedPostgres({
    databaseDir,
    user: 'studio',
    password: secrets.dbPassword,
    port: DB_PORT,
    persistent: true,
    onLog: () => {},
    onError: (error) => log(`postgres: ${error instanceof Error ? error.message : String(error)}`),
  })
  if (fresh) await postgres.initialise()
  await postgres.start()
  if (fresh) await postgres.createDatabase('studio')
  return `postgresql://studio:${encodeURIComponent(secrets.dbPassword)}@127.0.0.1:${DB_PORT}/studio`
}

/* Applies every migration folder not applied yet, oldest first, each in its
 * own transaction, and records it in _desktop_migrations. */
async function migrate() {
  const client = postgres.getPgClient('studio', '127.0.0.1')
  await client.connect()
  try {
    await client.query('CREATE TABLE IF NOT EXISTS _desktop_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    const applied = new Set((await client.query('SELECT name FROM _desktop_migrations')).rows.map((row) => row.name))
    const folders = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    for (const name of folders) {
      if (applied.has(name)) continue
      const sql = await readFile(path.join(MIGRATIONS_DIR, name, 'migration.sql'), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO _desktop_migrations (name) VALUES ($1)', [name])
        await client.query('COMMIT')
        log(`migration applied: ${name}`)
      } catch (error) {
        await client.query('ROLLBACK')
        throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  } finally {
    await client.end()
  }
}

function runNode(name, script, env) {
  const child = spawn(process.execPath, [script], { cwd: SERVER_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`))
  child.on('exit', (code) => {
    if (!stopping) {
      log(`${name} exited with code ${code}; shutting down`)
      void shutdown(1)
    }
  })
  children.push(child)
}

async function waitForServer() {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${APP_URL}/sign-in`)
      if (response.status < 500) return
    } catch {
      /* not listening yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('The studio server did not start in time.')
}

async function shutdown(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill('SIGTERM')
  await new Promise((resolve) => setTimeout(resolve, 1_500))
  try {
    await postgres?.stop()
  } catch (error) {
    log(`postgres stop failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  process.exit(code)
}

process.on('SIGTERM', () => void shutdown(0))
process.on('SIGINT', () => void shutdown(0))

try {
  await assertPortFree(DESKTOP_PORT, 'studio')
  await assertPortFree(DB_PORT, 'database')
  await mkdir(path.join(dataDir, 'storage'), { recursive: true })
  const secrets = await loadSecrets()
  const databaseUrl = await startDatabase(secrets)
  await migrate()

  /* PUBLISHING_APP_KEYS: the operator's OAuth app keys packed by bundle.mjs. */
  const publishingKeysFile = path.join(HERE, 'publishing-apps.json')
  const publishingKeys = existsSync(publishingKeysFile) ? JSON.parse(await readFile(publishingKeysFile, 'utf8')) : {}

  const env = {
    ...process.env,
    ...publishingKeys,
    NODE_ENV: 'production',
    PORT: String(DESKTOP_PORT),
    HOSTNAME: '127.0.0.1',
    DATABASE_URL: databaseUrl,
    BETTER_AUTH_SECRET: secrets.authSecret,
    BETTER_AUTH_URL: APP_URL,
    AI_KEYS_ENCRYPTION_KEY: secrets.encryptionKey,
    STUDIO_DESKTOP: 'true',
    STORAGE_DRIVER: 'local',
    STORAGE_LOCAL_DIR: path.join(dataDir, 'storage'),
    PORTAL_ENABLED: 'false',
  }
  runNode('server', path.join(SERVER_DIR, 'server.js'), env)
  runNode('worker', path.join(SERVER_DIR, 'worker.mjs'), env)
  await waitForServer()
  console.log(`READY ${APP_URL}`)
} catch (error) {
  console.log(`FAILED ${error instanceof Error ? error.message : String(error)}`)
  await shutdown(1)
}
