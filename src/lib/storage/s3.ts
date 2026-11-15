import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: s3StorageDriver, S3-compatible storage, s3Bucket,
 *   s3Endpoint, Cloudflare R2, MinIO, presigned URL
 *
 * WHAT:  Storage driver for any S3-compatible service — AWS S3, Cloudflare R2,
 *        MinIO, Backblaze B2, DigitalOcean Spaces.
 * WHY:   Production media must outlive any one machine and scale with large
 *        files (lecture videos). Downloads are served by short-lived presigned
 *        URLs so video bytes never pass through the app server. Objects stay
 *        private in the bucket; the asset route decides who gets a URL.
 *        The s3Endpoint and s3ForcePathStyle settings make non-AWS services work.
 * WHERE: Selected by getStorage() when the storageDriver setting is "s3".
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

import { platformSettingFlag, platformSettingText } from '@/lib/platform-settings'
import type { PlatformSettingKeyOf, StorageDriver } from '@/lib/types'

function requireSetting(key: PlatformSettingKeyOf<'text'>, label: string): string {
  const value = platformSettingText(key)
  if (!value) throw new Error(`${label} is required for S3 storage. Set it in portal settings under Media storage.`)
  return value
}

/* Rebuilt when any connection setting changes in the portal. */
let client: { fingerprint: string; s3: S3Client } | null = null

function getClient(): S3Client {
  const endpoint = platformSettingText('s3Endpoint')
  const options = {
    region: platformSettingText('s3Region') || 'auto',
    ...(endpoint ? { endpoint } : {}),
    forcePathStyle: platformSettingFlag('s3ForcePathStyle'),
    credentials: {
      accessKeyId: requireSetting('s3AccessKeyId', 'Access key ID'),
      secretAccessKey: requireSetting('s3SecretAccessKey', 'Secret access key'),
    },
  }
  const fingerprint = JSON.stringify(options)
  if (client?.fingerprint !== fingerprint) client = { fingerprint, s3: new S3Client(options) }
  return client.s3
}

const bucket = () => requireSetting('s3Bucket', 'Bucket')

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
