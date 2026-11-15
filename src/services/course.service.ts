import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: courseService, createCourse, listCourses,
 *   findCourse, findCourseWithCurriculum, findLatestDossier, createDossier,
 *   replaceCurriculumRows, findModuleInCourse, findLessonInCourse,
 *   setModulePositions, setLessonPositions, COURSE_SUMMARY_SELECT
 *
 * WHAT:  Pure Prisma for Course, ResearchDossier, Module, and Lesson.
 * WHY:   The only DB layer for Course State (CLAUDE.md §3). Takes a DbClient
 *        so routers (inside their tx) and agents (worker, inside persist tx)
 *        share it. Every lookup is scoped by organizationId or by a courseId
 *        the caller already proved belongs to the organization.
 * WHERE: courses + curriculum routers; research + curriculumArchitect agents;
 *        PLAN_COURSE completion hooks.
 */

import type { CourseStatus, Prisma } from '@/generated/prisma'
import type { DbClient } from '@/lib/config'

export const COURSE_SUMMARY_SELECT = {
  id: true,
  title: true,
  slug: true,
  status: true,
  brief: true,
  goal: true,
  outcomes: true,
  prerequisites: true,
  assessmentStrategy: true,
  guidedApproval: true,
  curriculumApprovedAt: true,
  subtitle: true,
  description: true,
  whatYouWillLearn: true,
  requirements: true,
  targetAudience: true,
  qualityReport: true,
  finalProject: true,
  cheatSheet: true,
  autopilot: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CourseSelect

// ── Course ───────────────────────────────────────────────────────────────

export function createCourse(db: DbClient, data: Prisma.CourseUncheckedCreateInput) {
  return db.course.create({ data, select: { id: true, title: true, slug: true } })
}

export function courseSlugExists(db: DbClient, organizationId: string, slug: string) {
  return db.course.count({ where: { organizationId, slug } }).then((n) => n > 0)
}

export async function listCourses(
  db: DbClient,
  organizationId: string,
  pagination: { skip: number; take: number },
  search?: string
) {
  /* Title search, case-insensitive; no search lists everything. */
  const where: Prisma.CourseWhereInput = search
    ? { organizationId, title: { contains: search, mode: 'insensitive' } }
    : { organizationId }
  const [items, total] = await Promise.all([
    db.course.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: pagination.skip,
      take: pagination.take,
      select: {
        id: true,
        title: true,
        status: true,
        curriculumApprovedAt: true,
        updatedAt: true,
        _count: { select: { modules: true, lessons: true } },
      },
    }),
    db.course.count({ where }),
  ])
  return { items, total }
}

export function findCourse(db: DbClient, organizationId: string, courseId: string) {
  return db.course.findFirst({ where: { id: courseId, organizationId }, select: COURSE_SUMMARY_SELECT })
}

export function findCourseWithCurriculum(db: DbClient, organizationId: string, courseId: string) {
  return db.course.findFirst({
    where: { id: courseId, organizationId },
    select: {
      ...COURSE_SUMMARY_SELECT,
      modules: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          position: true,
          title: true,
          summary: true,
          objectiveRefs: true,
          estimatedMinutes: true,
          bookChapter: { select: { startPage: true, endPage: true } },
          lessons: {
            orderBy: { position: 'asc' },
            select: {
              id: true,
              position: true,
              title: true,
              objectiveRefs: true,
              estimatedMinutes: true,
              status: true,
              kind: true,
              currentVersionId: true,
              bookStartPage: true,
              bookEndPage: true,
            },
          },
        },
      },
    },
  })
}

export function updateCourse(
  db: DbClient,
  organizationId: string,
  courseId: string,
  data: Prisma.CourseUncheckedUpdateInput
) {
  return db.course.update({ where: { id: courseId, organizationId }, data, select: { id: true, title: true } })
}

/** Status write used by hooks/agents that already hold a verified course id. */
export function setCourseStatus(db: DbClient, courseId: string, status: CourseStatus) {
  return db.course.update({ where: { id: courseId }, data: { status }, select: { id: true } })
}

export function deleteCourse(db: DbClient, organizationId: string, courseId: string) {
  return db.course.delete({ where: { id: courseId, organizationId }, select: { id: true, title: true } })
}

export function countLessons(db: DbClient, courseId: string) {
  return db.lesson.count({ where: { courseId } })
}

// ── Research ─────────────────────────────────────────────────────────────

export function findLatestDossier(db: DbClient, courseId: string) {
  return db.researchDossier.findFirst({
    where: { courseId },
    orderBy: { version: 'desc' },
    select: { id: true, version: true, content: true, createdAt: true },
  })
}

export function createDossier(db: DbClient, data: Prisma.ResearchDossierUncheckedCreateInput) {
  return db.researchDossier.create({ data, select: { id: true, version: true } })
}

// ── Curriculum rows ──────────────────────────────────────────────────────

/** Removes every module (lessons cascade) — only valid before approval. */
export function deleteCurriculumRows(db: DbClient, courseId: string) {
  return db.module.deleteMany({ where: { courseId } })
}

export function createModule(db: DbClient, data: Prisma.ModuleUncheckedCreateInput) {
  return db.module.create({ data, select: { id: true, title: true } })
}

export function createLessons(db: DbClient, data: Prisma.LessonCreateManyInput[]) {
  return db.lesson.createMany({ data })
}

export function createLesson(db: DbClient, data: Prisma.LessonUncheckedCreateInput) {
  return db.lesson.create({ data, select: { id: true, title: true } })
}

export function findModuleInCourse(db: DbClient, courseId: string, moduleId: string) {
  return db.module.findFirst({ where: { id: moduleId, courseId }, select: { id: true, position: true, objectiveRefs: true } })
}

export function findLessonInCourse(db: DbClient, courseId: string, lessonId: string) {
  return db.lesson.findFirst({
    where: { id: lessonId, courseId },
    select: { id: true, moduleId: true, position: true },
  })
}

export function updateModule(db: DbClient, moduleId: string, data: Prisma.ModuleUncheckedUpdateInput) {
  return db.module.update({ where: { id: moduleId }, data, select: { id: true, title: true } })
}

export function updateLesson(db: DbClient, lessonId: string, data: Prisma.LessonUncheckedUpdateInput) {
  return db.lesson.update({ where: { id: lessonId }, data, select: { id: true, title: true } })
}

export function deleteModule(db: DbClient, moduleId: string) {
  return db.module.delete({ where: { id: moduleId }, select: { id: true, title: true } })
}

export function deleteLesson(db: DbClient, lessonId: string) {
  return db.lesson.delete({ where: { id: lessonId }, select: { id: true, title: true } })
}

export function listModuleOrder(db: DbClient, courseId: string) {
  return db.module.findMany({ where: { courseId }, orderBy: { position: 'asc' }, select: { id: true } })
}

export function listLessonOrder(db: DbClient, moduleId: string) {
  return db.lesson.findMany({ where: { moduleId }, orderBy: { position: 'asc' }, select: { id: true } })
}

/** Rewrites positions 0..n-1 in the given order. */
export async function setModulePositions(db: DbClient, orderedIds: readonly string[]) {
  await Promise.all(orderedIds.map((id, position) => db.module.update({ where: { id }, data: { position } })))
}

export async function setLessonPositions(db: DbClient, orderedIds: readonly string[]) {
  await Promise.all(orderedIds.map((id, position) => db.lesson.update({ where: { id }, data: { position } })))
}

/** Recomputes a module's estimated minutes from its lessons. */
export async function refreshModuleMinutes(db: DbClient, moduleId: string) {
  const sum = await db.lesson.aggregate({ where: { moduleId }, _sum: { estimatedMinutes: true } })
  await db.module.update({ where: { id: moduleId }, data: { estimatedMinutes: sum._sum.estimatedMinutes ?? 0 } })
}

/**
 * SOURCE OF TRUTH KEYWORDS: ensureWelcomeLesson, Introduction module,
 *   welcome lecture
 *
 * WHAT:  Guarantees the course opens with an "Introduction" section holding a
 *        WELCOME lecture; creates it (shifting other sections down) if absent.
 * WHY:   Every Udemy-style course starts with a welcome video (docs/11 §1).
 *        Added at build time so approved curricula do not need re-planning.
 */
export async function ensureWelcomeLesson(db: DbClient, organizationId: string, courseId: string) {
  const existing = await db.lesson.findFirst({ where: { courseId, kind: 'WELCOME' }, select: { id: true } })
  if (existing) return existing
  await db.module.updateMany({ where: { courseId }, data: { position: { increment: 1 } } })
  const intro = await db.module.create({
    data: {
      organizationId,
      courseId,
      position: 0,
      title: 'Introduction',
      summary: 'Welcome to the course and how to get the most from it.',
      objectiveRefs: [],
      estimatedMinutes: 2,
    },
    select: { id: true },
  })
  return db.lesson.create({
    data: {
      organizationId,
      courseId,
      moduleId: intro.id,
      position: 0,
      title: 'Welcome to the course',
      kind: 'WELCOME',
      objectiveRefs: [],
      estimatedMinutes: 2,
      status: 'PLANNED',
    },
    select: { id: true },
  })
}
