import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: localStorageDriver, STORAGE_LOCAL_DIR, local disk
 *   storage, path traversal guard
 *
 * WHAT:  Storage driver that keeps objects as files under STORAGE_LOCAL_DIR
 *        (default `.storage/` in the project, gitignored).
 * WHY:   Zero-setup development. Content type is derived from the file
 *        extension (keys always carry one), so no sidecar metadata is needed.
 *        Every key is resolved and checked to stay inside the root, so a
 *        malformed key can never read or delete files elsewhere on disk.
 *        Not for production: files live on one machine's disk.
 * WHERE: Selected by getStorage() when STORAGE_DRIVER is "local" or unset.
 */

import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'

import type { StorageDriver } from '@/lib/types'

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.vtt': 'text/vtt',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.json': 'application/json',
}

function root(): string {
  return path.resolve(process.env['STORAGE_LOCAL_DIR'] || '.storage')
}

function resolveKey(key: string): string {
  const base = root()
  const full = path.resolve(base, key)
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new Error(`Storage key escapes the storage root: ${key}`)
  }
  return full
}

export const localStorageDriver: StorageDriver = {
  id: 'local',

  async put({ key, body }) {
    const file = resolveKey(key)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, body)
  },

  async get(key) {
    try {
      const body = await readFile(resolveKey(key))
      return {
        body: new Uint8Array(body),
        contentType: CONTENT_TYPES[path.extname(key).toLowerCase()] ?? 'application/octet-stream',
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null
      throw error
    }
  },

  async exists(key) {
    try {
      return (await stat(resolveKey(key))).isFile()
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
      throw error
    }
  },

  async deletePrefix(prefix) {
    await rm(resolveKey(prefix), { recursive: true, force: true })
  },

  async signedUrl() {
    return null
  },
}
