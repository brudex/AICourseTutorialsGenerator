/**
 * SOURCE OF TRUTH KEYWORDS: generationJobsRouter, generationJobs.get,
 *   generationJobs.listForCourse, generationJobs.cancel, generationJobs.retry,
 *   Agent Activity
 *
 * WHAT:  Read, cancel, and retry generation jobs (the Agent Activity screen).
 * WHY:   Jobs are CREATED by courses.generate (build step 4); this surface
 *        only observes and steers them. `get` is polled by the UI while a job
 *        runs, so it returns the compact task projection (no prompts, no
 *        outputs). State changes go through src/lib/generation so the router
 *        and the worker share one state machine.
 * WHERE: Mounted as `generationJobs` in src/trpc/routers/_app.ts.
 */

import { TRPCError } from '@trpc/server'

import { createTRPCRouter } from '../init'
import { protectedProcedure } from '../procedures'
import { permissions } from '@/lib/permissions'
import { generationJobIdSchema, listCourseJobsSchema, retryAgentTaskSchema } from '@/lib/types'
import { cancelGenerationJob, retryFailedTask } from '@/lib/generation'
import { summarizeTaskModels } from '@/lib/generation/task-models'
import { getAgent } from '@/lib/agents'
import * as generationService from '@/services/generation.service'

export const generationJobsRouter = createTRPCRouter({
  get: protectedProcedure({ requirePermission: permissions.GENERATION_JOBS_READ })
    .input(generationJobIdSchema)
    .query(async ({ ctx, input }) => {
      const job = await generationService.findJobWithTasks(ctx.db, input.organizationId, input.id)
      if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Generation job not found.' })
      /* Agent display names come from the server-only registry; raw ledger rows become the models each step called. */
      return {
        ...job,
        tasks: job.tasks.map(({ aiUsageEvents, ...task }) => {
          const agent = getAgent(task.agentId)
          return {
            ...task,
            agentName: agent?.name ?? task.agentId,
            agentDescription: agent?.description ?? null,
            models: summarizeTaskModels(aiUsageEvents),
          }
        }),
      }
    }),

  listForCourse: protectedProcedure({ requirePermission: permissions.GENERATION_JOBS_READ })
    .input(listCourseJobsSchema)
    .query(({ ctx, input }) => generationService.listCourseJobs(ctx.db, input.organizationId, input.courseId)),

  cancel: protectedProcedure({ requirePermission: permissions.GENERATION_JOBS_CANCEL })
    .input(generationJobIdSchema)
    .mutation(async ({ ctx, input }) => {
      const job = await generationService.findJobWithTasks(ctx.db, input.organizationId, input.id)
      if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Generation job not found.' })
      const cancelled = await cancelGenerationJob(ctx.db, job.id)
      if (!cancelled) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'This job has already finished and cannot be cancelled.' })
      }
      return cancelled
    }),

  retry: protectedProcedure({ requirePermission: permissions.GENERATION_JOBS_RETRY })
    .input(retryAgentTaskSchema)
    .mutation(async ({ ctx, input }) => {
      const task = await generationService.findTask(ctx.db, input.organizationId, input.taskId)
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'Task not found.' })
      const retried = await retryFailedTask(ctx.db, task)
      if (!retried) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Only failed tasks in an active (not cancelled) job can be retried.',
        })
      }
      return retried
    }),
})
