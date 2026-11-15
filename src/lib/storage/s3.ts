import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: s3StorageDriver, S3-compatible storage, S3_BUCKET,
 *   S3_ENDPOINT, Cloudflare R2, MinIO, presigned URL
 *
 * WHAT:  Storage driver for any S3-compatible service — AWS S3, Cloudflare R2,
 *        MinIO, Backblaze B2, DigitalOcean Spaces.
 * WHY:   Production media must outlive any one machine and scale with large
 *        files (lecture videos). Downloads are served by short-lived presigned
 *        URLs so video bytes never pass through the app server. Objects stay
 *        private in the bucket; the asset route decides who gets a URL.
 *        S3_ENDPOINT + S3_FORCE_PATH_STYLE make non-AWS services work.
 * WHERE: Selected by getStorage() when STORAGE_DRIVER="s3".
 */

import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import type { StorageDriver } from '@/lib/types'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required when STORAGE_DRIVER="s3".`)
  return value
}

let client: S3Client | null = null

function getClient(): S3Client {
  if (!client) {
    const endpoint = process.env['S3_ENDPOINT']
    client = new S3Client({
      region: process.env['S3_REGION'] || 'auto',
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] === 'true',
      credentials: {
        accessKeyId: requireEnv('S3_ACCESS_KEY_ID'),
        secretAccessKey: requireEnv('S3_SECRET_ACCESS_KEY'),
      },
    })
  }
  return client
}

const bucket = () => requireEnv('S3_BUCKET')

export const s3StorageDriver: StorageDriver = {
  id: 's3',

  async put({ key, body, contentType }) {
    await getClient().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }))
  },

  async get(key) {
    try {
      const result = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }))
      if (!result.Body) return null
      return {
        body: await result.Body.transformToByteArray(),
        contentType: result.ContentType ?? 'application/octet-stream',
      }
    } catch (error) {
      if (error instanceof NoSuchKey) return null
      throw error
    }
  },

  async exists(key) {
    try {
      await getClient().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }))
      return true
    } catch (error) {
      if (error instanceof Error && (error.name === 'NotFound' || error.name === 'NoSuchKey')) return false
      throw error
    }
  },

  async deletePrefix(prefix) {
    let token: string | undefined
    do {
      const page = await getClient().send(
        new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token })
      )
      const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []))
      if (keys.length > 0) {
        await getClient().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: keys } }))
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
  },

  async signedUrl(key, expiresInSeconds) {
    return getSignedUrl(getClient(), new GetObjectCommand({ Bucket: bucket(), Key: key }), {
      expiresIn: expiresInSeconds,
    })
  },
}
