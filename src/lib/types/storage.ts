/**
 * SOURCE OF TRUTH KEYWORDS: StorageDriver, StorageDriverId, STORAGE_DRIVER_IDS,
 *   StoredObject, PutObjectInput, StorageAdapter contract
 *
 * WHAT:  The contract every storage driver implements (local disk, S3-
 *        compatible), and the shapes passed through it.
 * WHY:   Media (stills, diagrams, narration audio, videos, downloads) is
 *        written by the worker and read by the asset route without either
 *        knowing where the bytes live — swapping local disk for S3, R2, or
 *        MinIO is one env var (STORAGE_DRIVER), the same seam pattern as the
 *        auth provider and the AI Gateway.
 * WHERE: Implemented in src/lib/storage/*; used by the visual renderer and
 *        /api/assets/[assetId]. Re-exported via src/lib/types.
 */

export const STORAGE_DRIVER_IDS = ['local', 's3'] as const
export type StorageDriverId = (typeof STORAGE_DRIVER_IDS)[number]

export interface PutObjectInput {
  key: string
  body: Uint8Array
  contentType: string
}

export interface StoredObject {
  body: Uint8Array
  contentType: string
}

export interface StorageDriver {
  id: StorageDriverId
  put: (input: PutObjectInput) => Promise<void>
  /** null when the object does not exist. */
  get: (key: string) => Promise<StoredObject | null>
  /** Whether an object is stored, without reading it (sync checks). */
  exists: (key: string) => Promise<boolean>
  /** Removes every object under a key prefix (e.g. a deleted course). */
  deletePrefix: (prefix: string) => Promise<void>
  /** A short-lived direct download URL, or null when the driver serves bytes itself. */
  signedUrl: (key: string, expiresInSeconds: number) => Promise<string | null>
}
