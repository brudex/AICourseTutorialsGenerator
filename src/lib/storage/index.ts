import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: getStorage, storageDriver, storage keys,
 *   courseStoragePrefix, sceneAssetKey
 *
 * WHAT:  Resolves the active storage driver from the storageDriver portal setting ("local" by
 *        default, "s3" in production) and defines how storage keys are laid
 *        out.
 * WHY:   One place owns the key layout so everything for a course lives under
 *        one prefix — deleting a course removes all of its files in one call.
 *        Scene files are keyed by scene id, and scenes belong to a lesson
 *        version, so re-rendering a version overwrites its own files and never
 *        an approved version's.
 * WHERE: Visual renderer (src/lib/agents/visual-renderer.ts), asset route,
 *        courses.delete, materials builder (materialAssetKey).
 */

import type { MaterialKind } from '@/generated/prisma'
import { COURSE_MATERIALS } from '@/lib/config/course-materials'
import { platformSettingText } from '@/lib/platform-settings'
import type { StorageDriver } from '@/lib/types'
import { localStorageDriver } from './local'
import { s3StorageDriver } from './s3'

/* Driver chosen per call from portal settings (Media storage). */
export function getStorage(): StorageDriver {
  return platformSettingText('storageDriver') === 's3' ? s3StorageDriver : localStorageDriver
}

export function courseStoragePrefix(organizationId: string, courseId: string): string {
  return `orgs/${organizationId}/courses/${courseId}/`
}

export function sceneAssetKey(params: {
  organizationId: string
  courseId: string
  lessonId: string
  sceneId: string
  variant: 'still' | 'diagram' | 'narration' | 'image'
  extension: 'png' | 'svg' | 'mp3' | 'wav' | 'ogg' | 'aac' | 'flac' | 'jpg' | 'webp'
}): string {
  return `${courseStoragePrefix(params.organizationId, params.courseId)}lessons/${params.lessonId}/scenes/${params.sceneId}-${params.variant}.${params.extension}`
}

/** Lecture-level files of one lesson version (captions now, MP4 in step 8). */
export function versionAssetKey(params: {
  organizationId: string
  courseId: string
  lessonId: string
  versionId: string
  variant: 'captions' | 'video'
  extension: 'vtt' | 'mp4'
}): string {
  return `${courseStoragePrefix(params.organizationId, params.courseId)}lessons/${params.lessonId}/versions/${params.versionId}-${params.variant}.${params.extension}`
}

/** A course-level download (workbook, answer key, ZIP); one file per kind. */
/**
 * SOURCE OF TRUTH KEYWORDS: bookAssetKey, course book storage key
 * WHAT:  Where a course's uploaded book PDF is stored (one per course).
 * WHY:   A fixed key means a re-upload replaces the file and its Asset row.
 * WHERE: courseBooks.upload / courseBooks.remove.
 */
export function bookAssetKey(params: { organizationId: string; courseId: string }): string {
  return `${courseStoragePrefix(params.organizationId, params.courseId)}book/source.pdf`
}

export function materialAssetKey(params: { organizationId: string; courseId: string; kind: MaterialKind }): string {
  return `${courseStoragePrefix(params.organizationId, params.courseId)}materials/${COURSE_MATERIALS[params.kind].fileName}`
}
