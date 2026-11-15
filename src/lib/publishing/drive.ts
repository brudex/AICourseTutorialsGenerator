import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: drivePublisher, Google Drive publish, Drive
 *   folder, Drive resumable upload, notes as Google Doc, course folder
 *
 * WHAT:  Saves the course to the connected Google Drive: a course folder, a
 *        numbered subfolder per section with each lecture's video, captions
 *        and notes (converted to a Google Doc), and a Downloads folder with
 *        every built file (workbook, cheat sheet, packages).
 * WHY:   Drive is the owner's own storage, so it gets everything, instructor
 *        files included, ready to share or import into any other platform.
 *        Uses the drive.file scope: the app only sees files it created.
 *        Every file is remembered, so retries resume.
 * WHERE: Dispatched by src/lib/publishing/run.ts.
 */

import { z } from 'zod'

import { PublishingPlatform } from '@/generated/prisma'
import type { Publisher, PublishRunContext } from '@/lib/types'
import { lessonBodyHtml } from '@/lib/render/documents'
import { publishingFetch, publishingJson, UPLOAD_TIMEOUT_MS } from './http'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER = 'application/vnd.google-apps.folder'
const GOOGLE_DOC = 'application/vnd.google-apps.document'
const fileSchema = z.object({ id: z.string().min(1) })

const pad = (n: number) => String(n).padStart(2, '0')
const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '').slice(0, 150).trim()

async function createFolder(context: PublishRunContext<'GOOGLE_DRIVE'>, key: string, name: string, parent: string | null) {
  const remembered = await context.recall(key)
  if (remembered) return remembered.externalId
  const folder = await publishingJson(
    'Google Drive',
    `${API}/files?fields=id`,
    {
      method: 'POST',
      token: await context.accessToken(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: safeName(name), mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }),
    },
    fileSchema
  )
  await context.remember(key, folder.id, `https://drive.google.com/drive/folders/${folder.id}`)
  return folder.id
}

/* Resumable upload: open a session with the metadata, then send the bytes. */
async function uploadFile(
  context: PublishRunContext<'GOOGLE_DRIVE'>,
  key: string,
  file: { name: string; parent: string; contentType: string; body: Uint8Array; convertTo?: string }
) {
  if (await context.recall(key)) return
  const session = await publishingFetch('Google Drive', `${UPLOAD_API}/files?uploadType=resumable&fields=id`, {
    method: 'POST',
    token: await context.accessToken(),
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': file.contentType,
      'X-Upload-Content-Length': String(file.body.byteLength),
    },
    body: JSON.stringify({ name: safeName(file.name), parents: [file.parent], ...(file.convertTo ? { mimeType: file.convertTo } : {}) }),
  })
  const uploadUrl = session.headers.get('location')
  if (!uploadUrl) throw new Error('Google Drive did not return an upload address.')
  const created = await publishingJson(
    'Google Drive',
    uploadUrl,
    { method: 'PUT', token: await context.accessToken(), headers: { 'Content-Type': file.contentType }, body: Buffer.from(file.body), timeoutMs: UPLOAD_TIMEOUT_MS },
    fileSchema
  )
  await context.remember(key, created.id)
}

function contentTypeFor(fileName: string) {
  if (fileName.endsWith('.pdf')) return 'application/pdf'
  if (fileName.endsWith('.zip')) return 'application/zip'
  if (fileName.endsWith('.csv')) return 'text/csv'
  return 'application/octet-stream'
}

function sectionsWithLectures(input: PublishRunContext['input']) {
  return input.modules
    .map((mod) => ({ mod, lectures: input.lectures.filter((l) => l.moduleId === mod.id && l.content !== null) }))
    .filter((section) => section.lectures.length > 0)
}

export const drivePublisher: Publisher<'GOOGLE_DRIVE'> = {
  platform: PublishingPlatform.GOOGLE_DRIVE,
  countItems: (input) =>
    1 + sectionsWithLectures(input).reduce((total, s) => total + 1 + s.lectures.length, 0) + (input.materials.length > 0 ? 1 + input.materials.length : 0),

  async publish(context) {
    const sections = sectionsWithLectures(context.input)
    if (sections.length === 0) throw new Error('No lecture has been written yet, so there is nothing to save.')

    const root = await createFolder(context, 'course:folder', context.options.folderName, null)
    let done = 1
    await context.progress(done)

    for (const [sectionIndex, section] of sections.entries()) {
      await context.assertLive()
      const folder = await createFolder(context, `module:${section.mod.id}:folder`, `${pad(sectionIndex + 1)} ${section.mod.title}`, root)
      done += 1
      await context.progress(done)

      for (const [lectureIndex, lecture] of section.lectures.entries()) {
        await context.assertLive()
        const base = `${pad(lectureIndex + 1)} ${lecture.title}`
        if (lecture.video) {
          context.log(`uploading "${lecture.title}" to Google Drive`)
          await uploadFile(context, `lecture:${lecture.lessonId}:video`, {
            name: `${base}.mp4`,
            parent: folder,
            contentType: 'video/mp4',
            body: await context.read(lecture.video.storageKey),
          })
        }
        if (lecture.captionsKey) {
          await uploadFile(context, `lecture:${lecture.lessonId}:captions`, {
            name: `${base}.vtt`,
            parent: folder,
            contentType: 'text/vtt',
            body: await context.read(lecture.captionsKey),
          })
        }
        if (lecture.content) {
          const html = `<h1>${escapeHtml(lecture.title)}</h1>${await lessonBodyHtml(lecture.content)}`
          await uploadFile(context, `lecture:${lecture.lessonId}:notes`, {
            name: `${base} notes`,
            parent: folder,
            contentType: 'text/html',
            body: new TextEncoder().encode(html),
            convertTo: GOOGLE_DOC,
          })
        }
        done += 1
        await context.progress(done)
      }
    }

    if (context.input.materials.length > 0) {
      const downloads = await createFolder(context, 'course:downloads', 'Downloads', root)
      done += 1
      await context.progress(done)
      for (const material of context.input.materials) {
        await context.assertLive()
        await uploadFile(context, `material:${material.fileName}`, {
          name: material.fileName,
          parent: downloads,
          contentType: contentTypeFor(material.fileName),
          body: await context.read(material.storageKey),
        })
        done += 1
        await context.progress(done)
      }
    }

    return { externalId: root, externalUrl: `https://drive.google.com/drive/folders/${root}` }
  },
}
