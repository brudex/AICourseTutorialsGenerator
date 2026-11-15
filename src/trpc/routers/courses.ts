/**
 * SOURCE OF TRUTH KEYWORDS: coursesRouter, courses.create, courses.list,
 *   courses.get, courses.update, courses.delete, courses.generate,
 *   courses.approve, courses.materials, courses.publish, PLAN_COURSE, BUILD_MATERIALS, EXPORT_COURSE, EXPORT_SCORM,
 *   curriculum approval checkpoint
 *
 * WHAT:  The course entity and its production controls: create from a brief,
 *        start generation, approve checkpoints.
 * WHY:   protectedProcedure supplies auth, courses:* permissions, the plan
 *        limit + usage counter on create/delete, transactions, and audit.
 *        This router owns the business rules:
 *          • generate never calls a model — it validates the course state,
 *            checks a model is routed, and writes the job DAG in the same
 *            transaction (spec §2);
 *          • only one live job per course;
 *          • a curriculum can be (re)planned until it is approved, and the
 *            approval closes the PLAN_COURSE job (human checkpoint, §25)
 *            and immediately queues BUILD_COURSE (lesson packages);
 *          • BUILD_COURSE can be re-run on an approved plan — it writes new
 *            versions, never overwriting existing content.
 * WHERE: Mounted as `courses`; used by the Courses pages.
 */

import { TRPCError } from '@trpc/server'
import { z } from 'zod'

import { slugify } from '@/lib/utils'
import { createTRPCRouter } from '../init'
import { protectedProcedure } from '../procedures'
import { CourseStatus, JobKind, JobStatus } from '@/generated/prisma'
import { permissions } from '@/lib/permissions'
import {
  approveCourseSchema,
  courseBriefSchema,
  courseIdSchema,
  courseQualityReportSchema,
  createCourseSchema,
  generateCourseSchema,
  learningOutcomeSchema,
  researchDossierContentSchema,
  updateCourseSchema,
  courseMaterialsQuerySchema,
  listCoursesSchema,
  type GenerateCourseValues,
} from '@/lib/types'
import {
  enqueueBuildCourse,
  enqueueResumeBuild,
  enqueueBuildMaterials,
  enqueueExportCourse,
  enqueueExportScorm,
  enqueueRenderNarration,
  enqueueRenderVideos,
  enqueueRenderVisuals,
} from '@/lib/courses/build-course'
import { courseStoragePrefix, getStorage } from '@/lib/storage'
import { enqueuePlanCourse } from '@/lib/courses/plan-course'
import * as courseService from '@/services/course.service'
import * as generationService from '@/services/generation.service'
import * as courseBookService from '@/services/course-book.service'
import { loadMaterialRows, loadPracticeView } from '@/lib/courses/course-views'

/* Statuses from which lesson generation may (re)start on an approved plan. */
const BUILDABLE_STATUSES: readonly CourseStatus[] = [
  CourseStatus.CURRICULUM_REVIEW,
  CourseStatus.REVIEW,
  CourseStatus.FAILED,
  CourseStatus.READY,
]

/* Statuses from which a (re)plan may start. */
const PLANNABLE_STATUSES: readonly CourseStatus[] = [
  CourseStatus.DRAFT,
  CourseStatus.CURRICULUM_REVIEW,
  CourseStatus.FAILED,
]

const slugifyCourse = (value: string) => slugify(value, 'course')

/* Jobs that only re-render or package existing lessons, keyed by kind. */
const FOLLOW_UP_JOBS: Partial<Record<GenerateCourseValues['kind'], typeof enqueueRenderVisuals>> = {
  RENDER_VISUALS: enqueueRenderVisuals,
  RENDER_NARRATION: enqueueRenderNarration,
  RENDER_VIDEO: enqueueRenderVideos,
  BUILD_MATERIALS: enqueueBuildMaterials,
  EXPORT_COURSE: enqueueExportCourse,
  EXPORT_SCORM: enqueueExportScorm,
}

const outcomesSchema = z.array(learningOutcomeSchema)

export const coursesRouter = createTRPCRouter({
  create: protectedProcedure({ requirePermission: permissions.COURSES_CREATE })
    .input(createCourseSchema)
    .mutation(async ({ ctx, input }) => {
      const base = slugifyCourse(input.brief.topic)
      let slug = base
      for (let n = 2; await courseService.courseSlugExists(ctx.db, input.organizationId, slug); n++) {
        slug = `${base}-${n}`
      }
      return courseService.createCourse(ctx.db, {
        organizationId: input.organizationId,
        createdById: ctx.user.id,
        title: input.brief.topic,
        slug,
        brief: input.brief,
      })
    }),

  list: protectedProcedure({ requirePermission: permissions.COURSES_READ, paginate: true })
    .input(listCoursesSchema)
    .query(async ({ ctx, input }) => {
      const { items, total } = await courseService.listCourses(ctx.db, input.organizationId, ctx.pagination, input.search || undefined)
      const { page, pageSize } = ctx.pagination
      return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
    }),

  get: protectedProcedure({ requirePermission: permissions.COURSES_READ })
    .input(courseIdSchema)
    .query(async ({ ctx, input }) => {
      const course = await courseService.findCourseWithCurriculum(ctx.db, input.organizationId, input.courseId)
      if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
      const [dossier, jobs] = await Promise.all([
        courseService.findLatestDossier(ctx.db, course.id),
        generationService.listCourseJobs(ctx.db, input.organizationId, course.id),
      ])
      const parsedDossier = dossier ? researchDossierContentSchema.safeParse(dossier.content) : null
      const outcomes = outcomesSchema.safeParse(course.outcomes)
      const quality = courseQualityReportSchema.safeParse(course.qualityReport)
      const brief = courseBriefSchema.safeParse(course.brief)
      return {
        ...course,
        audienceProfile: brief.success ? brief.data.audienceProfile : null,
        outcomes: outcomes.success ? outcomes.data : [],
        qualityReport: quality.success ? quality.data : null,
        research:
          dossier && parsedDossier?.success
            ? {
                version: dossier.version,
                createdAt: dossier.createdAt,
                summary: parsedDossier.data.summary,
                caveats: parsedDossier.data.caveats,
                keyConceptCount: parsedDossier.data.keyConcepts.length,
              }
            : null,
        latestJob: jobs[0] ?? null,
      }
    }),

  /* Section quizzes, final assessment and final project, validated on the
   * way out like every Json read. */
  practice: protectedProcedure({ requirePermission: permissions.COURSES_READ })
    .input(courseIdSchema)
    .query(async ({ ctx, input }) => {
      const course = await courseService.findCourseWithCurriculum(ctx.db, input.organizationId, input.courseId)
      if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
      return loadPracticeView(ctx.db, course)
    }),

  /* Downloads with their file sizes, in catalog order. Learner surfaces pass
   * audience LEARNER so the answer key never reaches them. */
  materials: protectedProcedure({ requirePermission: permissions.COURSES_READ })
    .input(courseMaterialsQuerySchema)
    .query(async ({ ctx, input }) => {
      const course = await courseService.findCourse(ctx.db, input.organizationId, input.courseId)
      if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
      return loadMaterialRows(ctx.db, course.id, input.audience)
    }),

  update: protectedProcedure({ requirePermission: permissions.COURSES_UPDATE })
    .input(updateCourseSchema)
    .mutation(async ({ ctx, input }) => {
      const course = await courseService.findCourse(ctx.db, input.organizationId, input.courseId)
      if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
      if (await generationService.hasLiveCourseJob(ctx.db, course.id)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Wait for the running generation to finish before editing.' })
      }
      /* Who the course is for lives on the brief, so later generations follow it. */
      const brief = courseBriefSchema.safeParse(course.brief)
      if (!brief.success) throw new TRPCError({ code: 'BAD_REQUEST', message: 'This course’s brief is incomplete. Create the course again.' })
      return courseService.updateCourse(ctx.db, input.organizationId, course.id, {
        title: input.title,
        subtitle: input.subtitle || null,
        description: input.description || null,
        brief: { ...brief.data, audienceProfile: input.audienceProfile },
      })
    }),

  delete: protectedProcedure({ requirePermission: permissions.COURSES_DELETE })
    .input(z.object({ organizationId: z.string().min(1), id: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const deleted = await courseService.deleteCourse(ctx.db, input.organizationId, input.id)
      /* Asset rows cascade with the course; the files need explicit removal.
       * Best-effort: a storage hiccup must not resurrect a deleted course. */
      try {
        await getStorage().deletePrefix(courseStoragePrefix(input.organizationId, input.id))
      } catch (error) {
        console.error('[courses.delete] could not remove stored files', error)
      }
      return deleted
    }),

  generate: protectedProcedure({ requirePermission: permissions.COURSES_GENERATE })
    .input(generateCourseSchema)
    .mutation(async ({ ctx, input }) => {
      const course = await courseService.findCourse(ctx.db, input.organizationId, input.courseId)
      if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })

      const followUp = FOLLOW_UP_JOBS[input.kind]
      if (followUp) {
        if (!course.curriculumApprovedAt || (await generationService.hasLiveCourseJob(ctx.db, course.id))) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Media and downloads can be built once lessons are written and no job is running.' })
        }
        const enqueue = followUp
        const job = await enqueue(ctx.db, {
          organizationId: input.organizationId,
          courseId: course.id,
          createdById: ctx.user.id,
        })
        return { id: job.id, courseId: course.id }
      }

      if (input.kind === 'BUILD_COURSE' || input.kind === 'RESUME_BUILD') {
        if (!course.curriculumApprovedAt) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'Approve the curriculum before generating lessons.' })
        }
        if (!BUILDABLE_STATUSES.includes(course.status) || (await generationService.hasLiveCourseJob(ctx.db, course.id))) {
          throw new TRPCError({ code: 'CONFLICT', message: 'A generation job is already running for this course.' })
        }
        const enqueue = input.kind === 'RESUME_BUILD' ? enqueueResumeBuild : enqueueBuildCourse
        const job = await enqueue(ctx.db, {
          organizationId: input.organizationId,
          courseId: course.id,
          createdById: ctx.user.id,
        })
        return { id: job.id, courseId: course.id }
      }

      if (course.curriculumApprovedAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'The curriculum is approved and can no longer be re-planned.' })
      }
      if (!PLANNABLE_STATUSES.includes(course.status)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'This course is already being generated.' })
      }
      if (await generationService.hasLiveCourseJob(ctx.db, course.id)) {
        throw new TRPCError({ code: 'CONFLICT', message: 'A generation job is already running for this course.' })
      }
      /* A book-based course plans from its ticked chapters only. */
      const book = await courseBookService.findCourseBook(ctx.db, course.id)
      if (book?.status === 'READING') {
        throw new TRPCError({ code: 'CONFLICT', message: 'The course book is still being read. Planning can start when it is done.' })
      }
      if (book && (await courseBookService.countSelectedChapters(ctx.db, course.id)) === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Tick at least one chapter of the course book before planning.' })
      }

      const job = await enqueuePlanCourse(ctx.db, {
        organizationId: input.organizationId,
        courseId: course.id,
        createdById: ctx.user.id,
        writeBrief: false,
      })
      return { id: job.id, courseId: course.id }
    }),

  approve: protectedProcedure({ requirePermission: permissions.COURSES_APPROVE })
    .input(approveCourseSchema)
    .mutation(async ({ ctx, input }) => {
      const course = await courseService.findCourse(ctx.db, input.organizationId, input.courseId)
      if (!course) throw new TRPCError({ code: 'NOT_FOUND', message: 'Course not found.' })
      if (course.status !== CourseStatus.CURRICULUM_REVIEW || course.curriculumApprovedAt) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'There is no curriculum waiting for approval.' })
      }
      if ((await courseService.countLessons(ctx.db, course.id)) === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Add at least one lesson before approving.' })
      }

      const planJob = await generationService.findLatestCourseJob(ctx.db, course.id, JobKind.PLAN_COURSE)
      if (planJob?.status === JobStatus.AWAITING_APPROVAL) {
        await generationService.transitionJob(ctx.db, planJob.id, [JobStatus.AWAITING_APPROVAL], {
          status: JobStatus.SUCCEEDED,
        })
      }
      await courseService.updateCourse(ctx.db, input.organizationId, course.id, { curriculumApprovedAt: new Date() })
      /* Approval is the go signal for lesson packages (blueprint §25). */
      const job = await enqueueBuildCourse(ctx.db, {
        organizationId: input.organizationId,
        courseId: course.id,
        createdById: ctx.user.id,
      })
      return { id: course.id, title: course.title, buildJobId: job.id }
    }),
})
