import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: encryptApiKey, decryptApiKey, apiKeyLast4,
 *   AI_KEYS_ENCRYPTION_KEY, AES-256-GCM, ProviderCredentials
 *
 * WHAT:  Encrypts / decrypts workspace AI provider API keys at rest.
 * WHY:   AES-256-GCM (authenticated: a tampered ciphertext fails to decrypt
 *        instead of yielding garbage). Stored as `v1:<iv>:<tag>:<ciphertext>`
 *        (base64) so the format can be versioned for key rotation later.
 *        The key is read lazily so a missing env var fails the CALL with a
 *        clear message rather than crashing module load for the whole app.
 * WHERE: aiProviders router (create/update) encrypts; src/lib/ai/gateway.ts
 *        decrypts immediately before a provider call. Publishing uses the same
 *        pair for platform credentials (publishing router, src/lib/publishing).
 *        Nothing else may call decryptApiKey, and its result must never leave
 *        the server.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const FORMAT_VERSION = 'v1'

function getKey(): Buffer {
  const raw = process.env['AI_KEYS_ENCRYPTION_KEY']
  if (!raw) {
    throw new Error('AI_KEYS_ENCRYPTION_KEY is not set — provider keys cannot be encrypted or read.')
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) {
    throw new Error('AI_KEYS_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32).')
  }
  return key
}

export function encryptApiKey(plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, getKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [FORMAT_VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join(':')
}

export function decryptApiKey(stored: string): string {
  const [version, iv, tag, ciphertext] = stored.split(':')
  if (version !== FORMAT_VERSION || !iv || !tag || !ciphertext) {
    throw new Error('Stored provider key is in an unknown format.')
  }
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(iv, 'base64'))
  decipher.setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64')), decipher.final()]).toString('utf8')
}

/** The only fragment of a key ever shown back to a user. */
export function apiKeyLast4(plaintext: string): string {
  return plaintext.slice(-4)
}
