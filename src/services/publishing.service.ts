import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: publishing.service, PublishingConnection, CoursePublication, PublishedItem,
 *   CONNECTION_PUBLIC_SELECT, findConnectionWithCredentials,
 *   upsertPublication, rememberPublishedItem
 *
 * WHAT:  Database access for publishing: connected accounts, course publications and the items created on platforms.
 * WHY:   The only layer that touches these tables. Reads meant for the
 *        browser use CONNECTION_PUBLIC_SELECT, which never includes the
 *        encrypted credentials; only the worker and the router's own
 *        server-side checks read them.
 * WHERE: src/trpc/routers/publishing.ts, src/lib/publishing/*, the
 *        coursePublisher agent and the PUBLISH_COURSE job hooks.
 */

import type { DbClient } from '@/lib/config'
import { PublicationStatus, type Prisma, type PublishingPlatform } from '@/generated/prisma'

// ── Connections ──────────────────────────────────────────────────────────

/* Safe for the browser: no credentials. */
export const CONNECTION_PUBLIC_SELECT = {
  id: true,
  platform: true,
  name: true,
  accountId: true,
  baseUrl: true,
  createdAt: true,
  createdBy: { select: { name: true, email: true } },
} satisfies Prisma.PublishingConnectionSelect

export function listConnections(db: DbClient, organizationId: string) {
  return db.publishingConnection.findMany({
    where: { organizationId },
    orderBy: { createdAt: 'asc' },
    select: CONNECTION_PUBLIC_SELECT,
  })
}

/* Server only: includes the encrypted credentials. */
export function findConnectionWithCredentials(db: DbClient, organizationId: string, id: string) {
  return db.publishingConnection.findFirst({
    where: { id, organizationId },
    select: { id: true, platform: true, name: true, baseUrl: true, accountId: true, credentialsCiphertext: true },
  })
}

/** Reconnecting the same account replaces its credentials instead of adding a duplicate. */
export async function saveConnection(
  db: DbClient,
  data: {
    organizationId: string
    platform: PublishingPlatform
    name: string
    accountId: string | null
    baseUrl: string | null
    credentialsCiphertext: string
    createdById: string
  }
) {
  const existing = await db.publishingConnection.findFirst({
    where: { organizationId: data.organizationId, platform: data.platform, accountId: data.accountId, baseUrl: data.baseUrl },
    select: { id: true },
  })
  if (existing) {
    return db.publishingConnection.update({
      where: { id: existing.id },
      data: { name: data.name, credentialsCiphertext: data.credentialsCiphertext },
      select: CONNECTION_PUBLIC_SELECT,
    })
  }
  return db.publishingConnection.create({ data, select: CONNECTION_PUBLIC_SELECT })
}

export function updateConnectionCredentials(db: DbClient, id: string, credentialsCiphertext: string) {
  return db.publishingConnection.update({ where: { id }, data: { credentialsCiphertext }, select: { id: true } })
}

export function deleteConnection(db: DbClient, organizationId: string, id: string) {
  return db.publishingConnection.deleteMany({ where: { id, organizationId } })
}

// ── Publications ─────────────────────────────────────────────────────────

export const PUBLICATION_SELECT = {
  id: true,
  platform: true,
  status: true,
  options: true,
  externalUrl: true,
  itemsDone: true,
  itemsTotal: true,
  error: true,
  publishedAt: true,
  updatedAt: true,
  lastJobId: true,
  connection: { select: { id: true, name: true, platform: true } },
} satisfies Prisma.CoursePublicationSelect

export function listCoursePublications(db: DbClient, organizationId: string, courseId: string) {
  return db.coursePublication.findMany({
    where: { organizationId, courseId },
    orderBy: { createdAt: 'asc' },
    select: PUBLICATION_SELECT,
  })
}

/** One row per (course, connection): publishing again reuses it. */
export function upsertPublication(
  db: DbClient,
  data: {
    organizationId: string
    courseId: string
    connectionId: string
    platform: PublishingPlatform
    options: Prisma.InputJsonObject
    createdById: string
  }
) {
  return db.coursePublication.upsert({
    where: { courseId_connectionId: { courseId: data.courseId, connectionId: data.connectionId } },
    create: { ...data, status: PublicationStatus.QUEUED },
    update: { options: data.options, status: PublicationStatus.QUEUED, error: null },
    select: { id: true, status: true },
  })
}

/** Worker read: the publication with its connection's credentials. */
export function findPublicationForRun(db: DbClient, id: string) {
  return db.coursePublication.findUnique({
    where: { id },
    select: {
      id: true,
      organizationId: true,
      courseId: true,
      platform: true,
      options: true,
      connection: {
        select: { id: true, platform: true, name: true, baseUrl: true, credentialsCiphertext: true },
      },
    },
  })
}

export function setPublicationJob(db: DbClient, id: string, jobId: string) {
  return db.coursePublication.update({ where: { id }, data: { lastJobId: jobId }, select: { id: true } })
}

export function startPublicationRun(db: DbClient, id: string, itemsTotal: number) {
  return db.coursePublication.update({
    where: { id },
    data: { status: PublicationStatus.RUNNING, itemsTotal, itemsDone: 0, error: null },
    select: { id: true },
  })
}

export function setPublicationProgress(db: DbClient, id: string, itemsDone: number) {
  return db.coursePublication.update({ where: { id }, data: { itemsDone }, select: { id: true } })
}

export function finishPublication(db: DbClient, id: string, result: { externalId: string; externalUrl: string }) {
  return db.coursePublication.update({
    where: { id },
    data: {
      status: PublicationStatus.PUBLISHED,
      externalId: result.externalId,
      externalUrl: result.externalUrl,
      publishedAt: new Date(),
      error: null,
    },
    select: { id: true },
  })
}

/** Job hooks: the publication a PUBLISH_COURSE job was running. */
export function failPublicationForJob(db: DbClient, jobId: string, error: string) {
  return db.coursePublication.updateMany({
    where: { lastJobId: jobId, status: { in: [PublicationStatus.QUEUED, PublicationStatus.RUNNING] } },
    data: { status: PublicationStatus.FAILED, error },
  })
}

/** The failed publish task's error, shown on the publication card. */
export async function findJobFailureReason(db: DbClient, jobId: string) {
  const task = await db.agentTask.findFirst({
    where: { jobId, status: 'FAILED' },
    orderBy: { updatedAt: 'desc' },
    select: { error: true },
  })
  return task?.error ?? null
}

export function requeuePublicationForJob(db: DbClient, jobId: string) {
  return db.coursePublication.updateMany({
    where: { lastJobId: jobId },
    data: { status: PublicationStatus.QUEUED, error: null },
  })
}

// ── Published items (resumable runs) ─────────────────────────────────────

export function findPublishedItem(db: DbClient, publicationId: string, key: string) {
  return db.publishedItem.findUnique({
    where: { publicationId_key: { publicationId, key } },
    select: { externalId: true, externalUrl: true },
  })
}

export function rememberPublishedItem(
  db: DbClient,
  data: { publicationId: string; key: string; externalId: string; externalUrl: string | null }
) {
  return db.publishedItem.upsert({
    where: { publicationId_key: { publicationId: data.publicationId, key: data.key } },
    create: data,
    update: { externalId: data.externalId, externalUrl: data.externalUrl },
    select: { id: true },
  })
}

/** The YouTube video id of a lecture, if this course was published to YouTube. */
export async function findYoutubeVideoId(db: DbClient, courseId: string, lessonId: string) {
  const item = await db.publishedItem.findFirst({
    where: {
      key: `lecture:${lessonId}:video`,
      publication: { courseId, platform: 'YOUTUBE' },
    },
    orderBy: { createdAt: 'desc' },
    select: { externalId: true },
  })
  return item?.externalId ?? null
}
