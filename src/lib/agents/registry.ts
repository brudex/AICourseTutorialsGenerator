import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: AGENT_REGISTRY, getAgent, AgentDefinition,
 *   agentId, agent team
 *
 * WHAT:  Every agent the worker can run, keyed by the `agentId` stored on
 *        AgentTask rows.
 * WHY:   The config-driven agent team (blueprint §38): adding an agent is one
 *        entry here, built with defineAgent. A task whose agentId is missing
 *        fails non-retryably with a clear message instead of looping.
 *        PLAN_COURSE: research, curriculumArchitect.
 *        BUILD_COURSE: lessonWriter → videoDirector / exerciseDesigner /
 *        assessmentDesigner → qaReviewer per lesson, plus courseLandingWriter;
 *        visualRenderer and narrator after videoDirector, then videoRenderer
 *        (each also runs alone in RENDER_VISUALS / RENDER_NARRATION /
 *        RENDER_VIDEO). After every lesson, cheatSheetWriter then
 *        materialsBuilder produce the downloads (also alone in BUILD_MATERIALS).
 *        EXPORT_COURSE runs courseExporter alone; EXPORT_SCORM runs scormExporter.
 *        READ_BOOK: bookPageReader per page range → bookAssembler (scanned books).
 *        Book-first PLAN_COURSE starts with briefWriter.
 * WHERE: Read by the worker's task runner (src/worker/run-task.ts).
 */

import type { AgentDefinition } from '@/lib/types'
import { researchAgent } from './research'
import { bookAssemblerAgent, bookPageReaderAgent } from './book-reader'
import { briefWriterAgent } from './brief-writer'
import { curriculumArchitectAgent } from './curriculum-architect'
import { lessonWriterAgent } from './lesson-writer'
import { videoDirectorAgent } from './video-director'
import { exerciseDesignerAgent } from './exercise-designer'
import { assessmentDesignerAgent } from './assessment-designer'
import { qaReviewerAgent } from './qa-reviewer'
import { courseLandingWriterAgent } from './course-landing-writer'
import { visualRendererAgent } from './visual-renderer'
import { narratorAgent } from './narrator'
import { videoRendererAgent } from './video-renderer'
import { sectionQuizDesignerAgent } from './section-quiz-designer'
import { finalAssessmentDesignerAgent } from './final-assessment-designer'
import { projectDesignerAgent } from './project-designer'
import { cheatSheetWriterAgent } from './cheat-sheet-writer'
import { materialsBuilderAgent } from './materials-builder'
import { courseExporterAgent } from './course-exporter'
import { scormExporterAgent } from './scorm-exporter'
import { coursePublisherAgent } from './course-publisher'

/**
 * SOURCE OF TRUTH KEYWORDS: AGENT_IDS, AgentId
 * The keys below are the agentId strings stored on AgentTask rows — renaming
 * one strands queued tasks, so treat them as a stable contract.
 */
export const AGENT_REGISTRY = {
  research: researchAgent,
  curriculumArchitect: curriculumArchitectAgent,
  lessonWriter: lessonWriterAgent,
  videoDirector: videoDirectorAgent,
  exerciseDesigner: exerciseDesignerAgent,
  assessmentDesigner: assessmentDesignerAgent,
  qaReviewer: qaReviewerAgent,
  courseLandingWriter: courseLandingWriterAgent,
  visualRenderer: visualRendererAgent,
  narrator: narratorAgent,
  videoRenderer: videoRendererAgent,
  sectionQuizDesigner: sectionQuizDesignerAgent,
  finalAssessmentDesigner: finalAssessmentDesignerAgent,
  projectDesigner: projectDesignerAgent,
  cheatSheetWriter: cheatSheetWriterAgent,
  materialsBuilder: materialsBuilderAgent,
  courseExporter: courseExporterAgent,
  scormExporter: scormExporterAgent,
  coursePublisher: coursePublisherAgent,
  bookPageReader: bookPageReaderAgent,
  bookAssembler: bookAssemblerAgent,
  briefWriter: briefWriterAgent,
} as const satisfies Readonly<Record<string, AgentDefinition>>

export type AgentId = keyof typeof AGENT_REGISTRY

function isAgentId(value: string): value is AgentId {
  return Object.prototype.hasOwnProperty.call(AGENT_REGISTRY, value)
}

export function getAgent(agentId: string): AgentDefinition | null {
  return isAgentId(agentId) ? AGENT_REGISTRY[agentId] : null
}
