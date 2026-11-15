/**
 * SOURCE OF TRUTH KEYWORDS: course-content barrel, LessonNotes, QuizQuestion,
 *   QuizAnswer, ProjectBriefView, SceneFrame, MaterialList
 *
 * WHAT:  Course content building blocks shared by the studio (lesson page,
 *        practice panel, downloads tab) and the learner preview player.
 * WHERE: Imported as '@/components/global/course-content'.
 */

export { LessonNotes } from './lesson-notes'
export { QuizQuestion } from './quiz-question'
export { QuizAnswer } from './quiz-answer'
export { ProjectBriefView } from './project-brief-view'
export { AssetImage, SCENE_LABELS, SceneFrame, formatDuration, sceneStartTimes } from './scene-frame'
export { MaterialList } from './material-list'
export { AssetHrefProvider, useAssetHref } from './asset-href'
