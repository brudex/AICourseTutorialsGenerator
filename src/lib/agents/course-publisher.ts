import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: coursePublisherAgent, Course Publisher,
 *   PUBLISH_COURSE task, publish to YouTube, publish to Canvas, publish to
 *   Google Classroom
 *
 * WHAT:  The only task of a PUBLISH_COURSE job: runs the publication
 *        (runPublication) and reports how many items it published and where.
 * WHY:   A tool step, no model call. Cancellation is checked between uploads
 *        through assertJobLive, so cancelling a long upload stops cleanly and
 *        a later publish resumes from what was already created.
 * WHERE: Registered as `coursePublisher` in AGENT_REGISTRY.
 */

import { z } from 'zod'

import { AiCapability } from '@/generated/prisma'
import type { AgentDefinition } from '@/lib/types'
import { AgentInputError } from '@/lib/generation/errors'
import { runPublication } from '@/lib/publishing'
import { assertJobLive } from './define-agent'

const coursePublisherInputSchema = z.object({ courseId: z.string().min(1), publicationId: z.string().min(1) })

export const coursePublisherAgent: AgentDefinition = {
  name: 'Course Publisher',
  description: 'Publishes the finished course to a connected platform',
  capability: AiCapability.FAST_TEXT,

  async execute(execution) {
    const parsed = coursePublisherInputSchema.safeParse(execution.task.input)
    if (!parsed.success) throw new AgentInputError('Task input for Course Publisher is invalid.')
    const { db, job } = execution
    const result = await runPublication(db, {
      publicationId: parsed.data.publicationId,
      organizationId: job.organizationId,
      assertLive: () => assertJobLive(db, job.id),
      log: (line) => console.log(`[publisher ${job.id}] ${line}`),
    })
    return { output: { items: result.items, url: result.externalUrl } }
  },
}
