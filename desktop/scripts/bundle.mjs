/**
 * SOURCE OF TRUTH KEYWORDS: desktop bundle, bundle.mjs, desktop build
 *   pipeline, standalone server, worker bundle, node sidecar, app resources
 *
 * WHAT:  Builds everything the Tauri installer ships, into desktop/build/app:
 *          server/      Next.js standalone server + static assets + public,
 *                       plus worker.mjs (the job worker, bundled by esbuild)
 *          runtime/     main.mjs (bundled) + the platform Postgres binaries
 *          migrations/  prisma/migrations
 *        and copies this machine's Node binary to src-tauri/binaries as the
 *        sidecar Tauri launches (named with the Rust target triple).
 * WHY:   The client bundle is compiled with the desktop URL and with
 *        subscriptions off, so a fresh install works with no configuration.
 *        Only compiled output is shipped: the standalone trace excludes the
 *        source tree (next.config.ts), and the worker is a single bundle.
 *        Run on each target OS to build that OS's installer.
 * WHERE: `npm run bundle` / `npm run build` in desktop/ (package.json).
 */

import { execFileSync } from 'node:child_process'
import { cp, mkdir, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ROOT = path.resolve(DESKTOP, '..')
const OUT = path.join(DESKTOP, 'build', 'app')
const DESKTOP_URL = 'http://127.0.0.1:47831'
const WINDOWS = process.platform === 'win32'
/* npm shims are .cmd files on Windows and need a shell to run. */
const ESBUILD = path.join(ROOT, 'node_modules', '.bin', WINDOWS ? 'esbuild.cmd' : 'esbuild')
const NPX = WINDOWS ? 'npx.cmd' : 'npx'
const ESM_SHIM = "import { createRequire as __cr } from 'node:module'; import { fileURLToPath as __fu } from 'node:url'; import { dirname as __dn } from 'node:path'; const require = __cr(import.meta.url); const __filename = __fu(import.meta.url); const __dirname = __dn(__filename);"

const run = (cmd, args, options = {}) =>
  execFileSync(WINDOWS && cmd.endsWith('.cmd') ? `"${cmd}"` : cmd, WINDOWS && cmd.endsWith('.cmd') ? args.map((a) => `"${a}"`) : args, {
    stdio: 'inherit',
    shell: WINDOWS && cmd.endsWith('.cmd'),
    ...options,
  })

/* MATERIALIZE_SYMLINKS: Next.js links its hashed external packages
 * (.next/node_modules/<name>-<hash> -> node_modules/<name>), and the Tauri
 * bundler drops symlinks when it copies resources, which breaks every page
 * that loads one. Replace each link with a real copy of its target. */
async function materializeSymlinks(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) {
      const target = await realpath(full)
      await rm(full)
      await cp(target, full, { recursive: true, dereference: true })
    } else if (entry.isDirectory()) {
      await materializeSymlinks(full)
    }
  }
}

/* SLIM_POSTGRES (macOS): the Postgres package ships every library under
 * three names (libicudata.dylib, .68.dylib, .68.2.dylib) as full copies.
 * Keep only the libraries the binaries and extensions actually link
 * (followed transitively with otool), which drops roughly 160 MB. */
async function slimPostgresMac(nativeDir) {
  const libDir = path.join(nativeDir, 'lib')
  const linked = (file) =>
    execFileSync('otool', ['-L', file], { encoding: 'utf8' })
      .split('\n')
      .slice(1)
      .map((line) => line.trim().split(' ')[0] ?? '')
      .filter((name) => name.startsWith('@rpath/') || name.startsWith('@loader_path/'))
      .map((name) => path.basename(name))
  const roots = [
    ...(await readdir(path.join(nativeDir, 'bin'))).map((f) => path.join(nativeDir, 'bin', f)),
    ...(await readdir(path.join(libDir, 'postgresql'))).filter((f) => f.endsWith('.dylib')).map((f) => path.join(libDir, 'postgresql', f)),
  ]
  const keep = new Set()
  const queue = [...roots]
  while (queue.length > 0) {
    const file = queue.pop()
    for (const name of linked(file)) {
      if (keep.has(name)) continue
      keep.add(name)
      const candidate = path.join(libDir, name)
      if (await stat(candidate).catch(() => null)) queue.push(candidate)
    }
  }
  let removed = 0
  for (const entry of await readdir(libDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.dylib') && !keep.has(entry.name)) {
      removed += (await stat(path.join(libDir, entry.name))).size
      await rm(path.join(libDir, entry.name))
    }
  }
  console.log(`  removed ${Math.round(removed / 1_048_576)} MB of unused Postgres libraries`)
}
const step = (line) => console.log(`\n▶ ${line}`)

function rustTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
  const triple = out.split('\n').find((line) => line.startsWith('host:'))?.slice(5).trim()
  if (!triple) throw new Error('Could not read the Rust host triple (is Rust installed?).')
  return triple
}

step('Building the Next.js standalone server')
await rm(path.join(ROOT, '.next', 'standalone'), { recursive: true, force: true })
run(NPX, ['next', 'build'], {
  cwd: ROOT,
  env: {
    ...process.env,
    /* BUILD_ENV_PLACEHOLDERS: pages prerendered at build time check the
     * required settings; real values come from the desktop runtime, so the
     * build only needs them present (also on CI machines with no .env). */
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://build:build@127.0.0.1:5432/build',
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'build-placeholder-secret',
    AI_KEYS_ENCRYPTION_KEY: process.env.AI_KEYS_ENCRYPTION_KEY ?? Buffer.alloc(32).toString('base64'),
    NEXT_OUTPUT: 'standalone',
    NEXT_PUBLIC_APP_URL: DESKTOP_URL,
    NEXT_PUBLIC_SUBSCRIPTIONS_ENABLED: 'false',
  },
})

step('Assembling server/')
await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
const server = path.join(OUT, 'server')
await cp(path.join(ROOT, '.next', 'standalone'), server, { recursive: true, verbatimSymlinks: true })
/* NEVER_SHIP_SECRETS: Next copies the project's .env files into standalone
 * output; the desktop runtime passes every value the app needs, so the
 * developer's keys must not travel inside the installer. */
for (const entry of await readdir(server)) {
  if (entry.startsWith('.env')) await rm(path.join(server, entry), { force: true })
}
await cp(path.join(ROOT, '.next', 'static'), path.join(server, '.next', 'static'), { recursive: true })
await cp(path.join(ROOT, 'public'), path.join(server, 'public'), { recursive: true })
await materializeSymlinks(server)

step('Bundling the job worker')
run(ESBUILD, [
  path.join(ROOT, 'src', 'worker', 'index.ts'),
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--target=node22',
  '--conditions=react-server',
  `--tsconfig=${path.join(ROOT, 'tsconfig.json')}`,
  '--external:@napi-rs/canvas',
  '--external:playwright-core',
  '--external:ffmpeg-static',
  `--banner:js=${ESM_SHIM}`,
  '--log-level=warning',
  `--outfile=${path.join(server, 'worker.mjs')}`,
], { cwd: ROOT })

step('Bundling the desktop runtime')
const runtime = path.join(OUT, 'runtime')
run(ESBUILD, [
  path.join(DESKTOP, 'runtime', 'main.mjs'),
  '--bundle',
  '--platform=node',
  '--format=esm',
  '--target=node22',
  '--external:@embedded-postgres/*',
  `--banner:js=${ESM_SHIM}`,
  '--log-level=warning',
  `--outfile=${path.join(runtime, 'main.mjs')}`,
], { cwd: DESKTOP })
const pgPlatform = path.join(DESKTOP, 'node_modules', '@embedded-postgres')
await cp(pgPlatform, path.join(runtime, 'node_modules', '@embedded-postgres'), { recursive: true, verbatimSymlinks: true })
if (process.platform === 'darwin') {
  await slimPostgresMac(path.join(runtime, 'node_modules', '@embedded-postgres', `darwin-${process.arch}`, 'native'))
}

/* PUBLISHING_APP_KEYS: the operator's OAuth apps (Google for YouTube and
 * Classroom, Canvas developer keys) ship inside the app so customers only
 * click Connect. Read from the build environment or the project's .env;
 * nothing is written when none are set (those platforms then show as
 * "Available soon"). Desktop OAuth clients cannot keep a secret from the
 * person running the app; Google and Canvas treat installed-app secrets as
 * non-confidential, and tokens stay on the customer's machine. */
step('Packing publishing app keys')
const rootEnv = existsSync(path.join(ROOT, '.env')) ? parseEnv(readFileSync(path.join(ROOT, '.env'), 'utf8')) : {}
const envValue = (key) => process.env[key] || rootEnv[key] || ''
const publishingKeys = Object.fromEntries(
  [
    ['GOOGLE_PUBLISHING_CLIENT_ID', envValue('GOOGLE_PUBLISHING_CLIENT_ID') || envValue('NEXT_PUBLIC_GOOGLE_CLIENT_ID')],
    ['GOOGLE_PUBLISHING_CLIENT_SECRET', envValue('GOOGLE_PUBLISHING_CLIENT_SECRET') || envValue('GOOGLE_CLIENT_SECRET')],
    ['VIMEO_CLIENT_ID', envValue('VIMEO_CLIENT_ID')],
    ['VIMEO_CLIENT_SECRET', envValue('VIMEO_CLIENT_SECRET')],
    ['CANVAS_OAUTH_APPS', envValue('CANVAS_OAUTH_APPS')],
  ].filter(([, value]) => value)
)
await writeFile(path.join(runtime, 'publishing-apps.json'), JSON.stringify(publishingKeys))
console.log(`  ${Object.keys(publishingKeys).length === 0 ? 'no publishing keys set' : `packed ${Object.keys(publishingKeys).join(', ')}`}`)

step('Copying migrations')
await cp(path.join(ROOT, 'prisma', 'migrations'), path.join(OUT, 'migrations'), { recursive: true })

step('Copying the Node sidecar')
const binaries = path.join(DESKTOP, 'src-tauri', 'binaries')
await mkdir(binaries, { recursive: true })
const ext = process.platform === 'win32' ? '.exe' : ''
const sidecar = path.join(binaries, `node-${rustTriple()}${ext}`)
if (existsSync(sidecar)) await rm(sidecar)
await cp(process.execPath, sidecar)
/* A universal macOS Node carries both CPU types; keep only this one (the
 * installer is built per architecture), halving the sidecar. */
if (process.platform === 'darwin' && execFileSync('lipo', ['-archs', sidecar], { encoding: 'utf8' }).trim().includes(' ')) {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64'
  run('lipo', [sidecar, '-thin', arch, '-output', `${sidecar}.thin`])
  await rm(sidecar)
  await cp(`${sidecar}.thin`, sidecar)
  await rm(`${sidecar}.thin`)
}

console.log(`\n✓ Desktop bundle ready in ${OUT}`)
