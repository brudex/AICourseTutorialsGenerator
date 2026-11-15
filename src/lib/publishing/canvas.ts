import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: canvasPublisher, Canvas LMS publish, canvasApi,
 *   uploadCanvasFile, Canvas modules, Canvas pages, Canvas quizzes,
 *   verifyCanvasToken, listCanvasTeacherCourses, canvasQuestion
 *
 * WHAT:  Publishes a course into an existing Canvas course: a module per
 *        section holding one page per lecture (embedded video + notes) and
 *        the section quiz, plus a Downloads module with the learner files.
 *        Also verifies a Canvas token and lists the courses it can teach.
 * WHY:   Teachers usually cannot create Canvas courses (admins do), so the
 *        author picks a course they teach and it is filled in. Quizzes are
 *        created unpublished, filled, then published, because Canvas freezes
 *        a published quiz's question set. Each question type maps to the
 *        closest Canvas type; written answers become essay questions graded
 *        by the teacher. Everything created is remembered so retries resume.
 * WHERE: Registered in PUBLISHERS; verify/list used by the publishing router.
 */

import { z } from 'zod'

import { PublishingPlatform } from '@/generated/prisma'
import type { AssessmentItemContent, Publisher, PublishRunContext } from '@/lib/types'
import { lessonBodyHtml } from '@/lib/render/documents'
import { publishingFetch, publishingJson, UPLOAD_TIMEOUT_MS } from './http'

const idSchema = z.object({ id: z.union([z.number(), z.string()]).transform(String) })
const pageSchema = z.object({ url: z.string(), page_id: z.union([z.number(), z.string()]).transform(String) })
const courseSchema = z.object({
  id: z.union([z.number(), z.string()]).transform(String),
  name: z.string(),
  course_code: z.string().nullish(),
  html_url: z.string().optional(),
})
const uploadSlotSchema = z.object({ upload_url: z.string(), upload_params: z.record(z.string(), z.string()) })

function canvasUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/api/v1${path}`
}

async function canvasApi<T>(
  context: PublishRunContext<'CANVAS'>,
  path: string,
  init: { method: string; body?: object },
  schema: z.ZodType<T>
): Promise<T> {
  const baseUrl = context.connection.baseUrl
  if (!baseUrl) throw new Error('This Canvas connection has no site address.')
  return publishingJson(
    'Canvas',
    canvasUrl(baseUrl, path),
    {
      method: init.method,
      token: await context.accessToken(),
      ...(init.body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) } : {}),
    },
    schema
  )
}

// ── Connecting ───────────────────────────────────────────────────────────

const selfSchema = z.object({ id: z.union([z.number(), z.string()]).transform(String), name: z.string() })

/** Proves the token works; returns the Canvas user it belongs to. */
export function verifyCanvasToken(baseUrl: string, token: string) {
  return publishingJson('Canvas', canvasUrl(baseUrl, '/users/self'), { token }, selfSchema)
}

/** Courses the token's user teaches, newest first, for the Publish dialog. */
export async function listCanvasTeacherCourses(baseUrl: string, token: string) {
  const courses = await publishingJson(
    'Canvas',
    canvasUrl(baseUrl, '/courses?enrollment_type=teacher&state[]=available&state[]=unpublished&per_page=100'),
    { token },
    z.array(courseSchema)
  )
  return courses.map((course) => ({ id: course.id, name: course.name, code: course.course_code ?? null }))
}

// ── Files ────────────────────────────────────────────────────────────────

/** Canvas file upload: ask for a slot, send the file, follow the confirm redirect. */
async function uploadCanvasFile(
  context: PublishRunContext<'CANVAS'>,
  file: { name: string; contentType: string; body: Uint8Array; folder: string }
): Promise<string> {
  const slot = await canvasApi(
    context,
    `/courses/${context.options.canvasCourseId}/files`,
    {
      method: 'POST',
      body: { name: file.name, size: file.body.byteLength, content_type: file.contentType, parent_folder_path: file.folder, on_duplicate: 'rename' },
    },
    uploadSlotSchema
  )
  const form = new FormData()
  for (const [key, value] of Object.entries(slot.upload_params)) form.append(key, value)
  form.append('file', new Blob([Buffer.from(file.body)], { type: file.contentType }), file.name)

  const uploaded = await publishingFetch('Canvas', slot.upload_url, {
    method: 'POST',
    body: form,
    redirect: 'manual',
    timeoutMs: UPLOAD_TIMEOUT_MS,
  })
  const confirmUrl = uploaded.status >= 300 && uploaded.status < 400 ? uploaded.headers.get('location') : null
  if (confirmUrl) {
    const confirmed = await publishingJson('Canvas', confirmUrl, { token: await context.accessToken() }, idSchema)
    return confirmed.id
  }
  const parsed = idSchema.safeParse(await uploaded.json())
  if (!parsed.success) throw new Error('Canvas did not confirm the file upload.')
  return parsed.data.id
}

// ── Quizzes ──────────────────────────────────────────────────────────────

interface CanvasQuestion {
  question_name: string
  question_text: string
  question_type: string
  points_possible: number
  neutral_comments: string
  answers: Array<Record<string, string | number>>
}

function escapeHtml(text: string) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The closest Canvas question type for each of our assessment items. */
export function canvasQuestion(item: AssessmentItemContent, index: number): CanvasQuestion {
  const base = { question_name: `Question ${index + 1}`, points_possible: 1, neutral_comments: item.explanation }
  switch (item.type) {
    case 'MULTIPLE_CHOICE':
      return {
        ...base,
        question_text: escapeHtml(item.question),
        question_type: 'multiple_choice_question',
        answers: item.options.map((o) => ({ answer_text: o.text, answer_weight: o.id === item.correctOptionId ? 100 : 0 })),
      }
    case 'SCENARIO':
      return {
        ...base,
        question_text: `<p>${escapeHtml(item.scenario)}</p><p>${escapeHtml(item.question)}</p>`,
        question_type: 'multiple_choice_question',
        answers: item.options.map((o) => ({ answer_text: o.text, answer_weight: o.id === item.correctOptionId ? 100 : 0 })),
      }
    case 'MULTIPLE_RESPONSE':
      return {
        ...base,
        question_text: escapeHtml(item.question),
        question_type: 'multiple_answers_question',
        answers: item.options.map((o) => ({ answer_text: o.text, answer_weight: item.correctOptionIds.includes(o.id) ? 100 : 0 })),
      }
    case 'TRUE_FALSE':
      return {
        ...base,
        question_text: escapeHtml(item.statement),
        question_type: 'true_false_question',
        answers: [
          { answer_text: 'True', answer_weight: item.answer ? 100 : 0 },
          { answer_text: 'False', answer_weight: item.answer ? 0 : 100 },
        ],
      }
    case 'MATCHING':
      return {
        ...base,
        question_text: escapeHtml(item.prompt),
        question_type: 'matching_question',
        answers: item.pairs.map((p) => ({ answer_match_left: p.left, answer_match_right: p.right, answer_weight: 100 })),
      }
    case 'FILL_BLANK':
      /* One blank: Canvas checks the typed word. Several: the teacher grades. */
      return item.answers.length === 1
        ? {
            ...base,
            question_text: escapeHtml(item.text),
            question_type: 'short_answer_question',
            answers: [{ answer_text: item.answers[0] ?? '', answer_weight: 100 }],
          }
        : { ...base, question_text: escapeHtml(item.text), question_type: 'essay_question', answers: [] }
    case 'SHORT_ANSWER':
      return { ...base, question_text: escapeHtml(item.question), question_type: 'essay_question', answers: [] }
  }
}

async function ensureQuiz(
  context: PublishRunContext<'CANVAS'>,
  key: string,
  title: string,
  items: readonly AssessmentItemContent[]
): Promise<string> {
  const remembered = await context.recall(key)
  if (remembered) return remembered.externalId
  const courseId = context.options.canvasCourseId
  const quiz = await canvasApi(
    context,
    `/courses/${courseId}/quizzes`,
    { method: 'POST', body: { quiz: { title, quiz_type: 'assignment', allowed_attempts: -1, published: false } } },
    idSchema
  )
  for (const [index, item] of items.entries()) {
    await canvasApi(context, `/courses/${courseId}/quizzes/${quiz.id}/questions`, { method: 'POST', body: { question: canvasQuestion(item, index) } }, idSchema)
  }
  await canvasApi(context, `/courses/${courseId}/quizzes/${quiz.id}`, { method: 'PUT', body: { quiz: { published: true } } }, idSchema)
  await context.remember(key, quiz.id)
  return quiz.id
}

// ── Publisher ────────────────────────────────────────────────────────────

function sectionsWithLectures(input: PublishRunContext['input']) {
  return input.modules
    .map((mod) => ({
      mod,
      lectures: input.lectures.filter((l) => l.moduleId === mod.id && l.content !== null),
      quiz: input.source.sectionQuizzes.find((q) => q.moduleId === mod.id)?.items ?? [],
    }))
    .filter((section) => section.lectures.length > 0)
}

async function addModuleItem(
  context: PublishRunContext<'CANVAS'>,
  key: string,
  moduleId: string,
  item: { type: 'Page'; page_url: string; title: string } | { type: 'Quiz' | 'File'; content_id: string; title: string }
) {
  if (await context.recall(key)) return
  const created = await canvasApi(
    context,
    `/courses/${context.options.canvasCourseId}/modules/${moduleId}/items`,
    { method: 'POST', body: { module_item: item } },
    idSchema
  )
  await context.remember(key, created.id)
}

async function ensureModule(context: PublishRunContext<'CANVAS'>, key: string, name: string, position: number) {
  const remembered = await context.recall(key)
  if (remembered) return remembered.externalId
  const created = await canvasApi(
    context,
    `/courses/${context.options.canvasCourseId}/modules`,
    { method: 'POST', body: { module: { name: name.slice(0, 255), position, published: true } } },
    idSchema
  )
  await context.remember(key, created.id)
  return created.id
}

export const canvasPublisher: Publisher<'CANVAS'> = {
  platform: PublishingPlatform.CANVAS,
  countItems: (input) => {
    const sections = sectionsWithLectures(input)
    const learnerFiles = input.materials.filter((m) => m.audience === 'LEARNER').length
    return sections.reduce((total, s) => total + 1 + s.lectures.length + (s.quiz.length > 0 ? 1 : 0), 0) + learnerFiles
  },

  async publish(context) {
    const baseUrl = context.connection.baseUrl
    if (!baseUrl) throw new Error('This Canvas connection has no site address.')
    const courseId = context.options.canvasCourseId
    const course = await canvasApi(context, `/courses/${courseId}`, { method: 'GET' }, courseSchema)
    const sections = sectionsWithLectures(context.input)
    if (sections.length === 0) throw new Error('No lecture has been written yet, so there is nothing to publish.')

    let done = 0
    for (const [sectionIndex, section] of sections.entries()) {
      await context.assertLive()
      const moduleId = await ensureModule(context, `module:${section.mod.id}`, section.mod.title, sectionIndex + 1)
      done += 1
      await context.progress(done)

      for (const lecture of section.lectures) {
        await context.assertLive()
        let fileId: string | null = null
        if (lecture.video) {
          const fileKey = `lecture:${lecture.lessonId}:file`
          fileId = (await context.recall(fileKey))?.externalId ?? null
          if (!fileId) {
            context.log(`uploading "${lecture.title}" to Canvas`)
            fileId = await uploadCanvasFile(context, {
              name: `${lecture.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 120)}.mp4`,
              contentType: 'video/mp4',
              body: await context.read(lecture.video.storageKey),
              folder: 'course videos',
            })
            await context.remember(fileKey, fileId)
          }
        }

        const pageKey = `lecture:${lecture.lessonId}:page`
        let page = await context.recall(pageKey)
        if (!page) {
          const video = fileId
            ? `<p><iframe style="width: 100%; aspect-ratio: 16 / 9; border: 0;" src="${baseUrl}/media_attachments_iframe/${fileId}?type=video&amp;embedded=true" allowfullscreen="allowfullscreen" title="${escapeHtml(lecture.title)}"></iframe></p>` +
              `<p><a href="${baseUrl}/courses/${courseId}/files/${fileId}/download">Download the lecture video</a></p>`
            : ''
          const notes = lecture.content ? await lessonBodyHtml(lecture.content) : ''
          const created = await canvasApi(
            context,
            `/courses/${courseId}/pages`,
            { method: 'POST', body: { wiki_page: { title: lecture.title.slice(0, 255), body: video + notes, published: true } } },
            pageSchema
          )
          await context.remember(pageKey, created.url, `${baseUrl}/courses/${courseId}/pages/${created.url}`)
          page = { externalId: created.url, externalUrl: null }
        }
        await addModuleItem(context, `lecture:${lecture.lessonId}:item`, moduleId, { type: 'Page', page_url: page.externalId, title: lecture.title.slice(0, 255) })
        done += 1
        await context.progress(done)
      }

      if (section.quiz.length > 0) {
        const quizId = await ensureQuiz(context, `module:${section.mod.id}:quiz`, `${section.mod.title}: section quiz`.slice(0, 255), section.quiz)
        await addModuleItem(context, `module:${section.mod.id}:quiz-item`, moduleId, { type: 'Quiz', content_id: quizId, title: 'Section quiz' })
        done += 1
        await context.progress(done)
      }
    }

    const learnerFiles = context.input.materials.filter((m) => m.audience === 'LEARNER')
    if (learnerFiles.length > 0) {
      const downloadsModule = await ensureModule(context, 'course:downloads', 'Course downloads', sections.length + 1)
      for (const material of learnerFiles) {
        await context.assertLive()
        const fileKey = `material:${material.fileName}`
        let fileId = (await context.recall(fileKey))?.externalId ?? null
        if (!fileId) {
          fileId = await uploadCanvasFile(context, {
            name: material.fileName,
            contentType: material.fileName.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
            body: await context.read(material.storageKey),
            folder: 'course downloads',
          })
          await context.remember(fileKey, fileId)
        }
        await addModuleItem(context, `material:${material.fileName}:item`, downloadsModule, { type: 'File', content_id: fileId, title: material.title })
        done += 1
        await context.progress(done)
      }
    }

    return { externalId: course.id, externalUrl: course.html_url ?? `${baseUrl}/courses/${course.id}/modules` }
  },
}
