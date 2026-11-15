import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: classroomPublisher, Google Classroom publish,
 *   courses.create, topics.create, courseWorkMaterials.create, class topics
 *
 * WHAT:  Publishes a course to Google Classroom: a class, one topic per
 *        section, and one material per lecture in order. A lecture already
 *        on YouTube (published from this course) is attached as its video;
 *        otherwise the material carries the lecture's objectives.
 * WHY:   Classroom stores links and Drive files, not uploaded videos, so the
 *        YouTube publication is the video source. Runs are resumable through
 *        PublishedItem like every publisher.
 * WHERE: Registered in PUBLISHERS (src/lib/publishing/index.ts).
 */

import { z } from 'zod'

import { PublishingPlatform } from '@/generated/prisma'
import type { Publisher, PublishRunContext } from '@/lib/types'
import { publishingJson } from './http'

const API = 'https://classroom.googleapis.com/v1'
const createdSchema = z.object({ id: z.string().min(1), alternateLink: z.string().optional() })
const topicSchema = z.object({ topicId: z.string().min(1) })

async function postJson<T>(context: PublishRunContext<'GOOGLE_CLASSROOM'>, path: string, body: object, schema: z.ZodType<T>) {
  return publishingJson(
    'Google Classroom',
    `${API}${path}`,
    {
      method: 'POST',
      token: await context.accessToken(),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    schema
  )
}

function lecturesByModule(input: PublishRunContext['input']) {
  return input.modules
    .map((mod) => ({ mod, lectures: input.lectures.filter((l) => l.moduleId === mod.id && l.content !== null) }))
    .filter((group) => group.lectures.length > 0)
}

export const classroomPublisher: Publisher<'GOOGLE_CLASSROOM'> = {
  platform: PublishingPlatform.GOOGLE_CLASSROOM,
  /* Class + a topic per section + a material per lecture. */
  countItems: (input) =>
    1 + lecturesByModule(input).reduce((total, group) => total + 1 + group.lectures.length, 0),

  async publish(context) {
    const groups = lecturesByModule(context.input)
    if (groups.length === 0) throw new Error('No lecture has been written yet, so there is nothing to post.')

    let course = await context.recall('course:class')
    if (!course) {
      const created = await postJson(
        context,
        '/courses',
        {
          name: context.options.className,
          section: context.options.section || undefined,
          descriptionHeading: context.input.course.title.slice(0, 3_000),
          description: (context.input.course.description ?? context.input.course.subtitle ?? '').slice(0, 30_000),
          ownerId: 'me',
          courseState: 'ACTIVE',
        },
        createdSchema
      )
      const url = created.alternateLink ?? `https://classroom.google.com/c/${created.id}`
      await context.remember('course:class', created.id, url)
      course = { externalId: created.id, externalUrl: url }
    }
    let done = 1
    await context.progress(done)

    for (const group of groups) {
      await context.assertLive()
      const topicKey = `module:${group.mod.id}:topic`
      let topicId = (await context.recall(topicKey))?.externalId ?? null
      if (!topicId) {
        const topic = await postJson(context, `/courses/${course.externalId}/topics`, { name: group.mod.title.slice(0, 100) }, topicSchema)
        topicId = topic.topicId
        await context.remember(topicKey, topicId)
      }
      done += 1
      await context.progress(done)

      for (const lecture of group.lectures) {
        const materialKey = `lecture:${lecture.lessonId}:material`
        if (!(await context.recall(materialKey))) {
          const videoId = await context.youtubeVideoFor(lecture.lessonId)
          const objectives = lecture.content?.objectives ?? []
          const material = await postJson(
            context,
            `/courses/${course.externalId}/courseWorkMaterials`,
            {
              title: lecture.title.slice(0, 3_000),
              description: objectives.length > 0 ? `In this lecture:\n${objectives.map((o) => `• ${o}`).join('\n')}` : undefined,
              topicId,
              state: 'PUBLISHED',
              ...(videoId ? { materials: [{ youtubeVideo: { id: videoId } }] } : {}),
            },
            createdSchema
          )
          await context.remember(materialKey, material.id, material.alternateLink ?? null)
        }
        done += 1
        await context.progress(done)
      }
    }

    return { externalId: course.externalId, externalUrl: course.externalUrl ?? `https://classroom.google.com/c/${course.externalId}` }
  },
}
