/**
 * SOURCE OF TRUTH KEYWORDS: CourseListItem, CourseDetail, CourseModuleRow,
 *   CourseLessonRow, GenerationJobDetail, GenerationTaskRow, LessonPackage,
 *   LessonSceneRow, LessonExerciseRow, LessonQuizRow, CourseMaterialRow,
 *   PlayerCourse, PlayerModule, PlayerLesson, PlayerPractice, course player,
 *   CourseBookView, CourseBookChapterRow, DashboardCourses, DashboardUsage
 *
 * WHAT:  Client types for the Courses pages, derived from router outputs so
 *        they can't drift from the server contract.
 * WHY:   Same router-derived pattern as team/_components/member-types.ts.
 *        The Player* types are the narrow slice of the studio outputs the
 *        shared course player needs, so the player stays reusable by any
 *        data source that can supply that shape.
 * WHERE: dashboard/courses/** components, components/global/course-player.
 *        Re-exported via src/lib/types.
 */

import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/trpc/routers/_app'

type Outputs = inferRouterOutputs<AppRouter>

export type CourseListItem = Outputs['courses']['list']['items'][number]
export type CourseDetail = Outputs['courses']['get']
export type CourseModuleRow = CourseDetail['modules'][number]
export type CourseLessonRow = CourseModuleRow['lessons'][number]
export type GenerationJobDetail = Outputs['generationJobs']['get']
export type GenerationTaskRow = GenerationJobDetail['tasks'][number]
export type LessonPackage = Outputs['lessons']['get']
export type LessonSceneRow = LessonPackage['scenes'][number]
export type LessonExerciseRow = LessonPackage['exercises'][number]
export type LessonQuizRow = LessonPackage['quiz'][number]
export type CourseMaterialRow = Outputs['courses']['materials'][number]
export type CoursePractice = Outputs['courses']['practice']
export type CourseBookView = NonNullable<Outputs['courseBooks']['get']>
export type CourseBookChapterRow = CourseBookView['chapters'][number]
export type DashboardCourses = Outputs['dashboard']['courses']
export type DashboardActivity = Outputs['dashboard']['activity']
export type DashboardUsage = Outputs['dashboard']['usage']
export type DashboardSetup = Outputs['dashboard']['setup']
export type PlayerCourse = Pick<CourseDetail, 'id' | 'title' | 'description' | 'whatYouWillLearn' | 'modules'> & {
  language: string
}
export type PlayerModule = PlayerCourse['modules'][number]
export type PlayerPractice = CoursePractice
export type PlayerLesson = Omit<LessonPackage, 'qa'>
