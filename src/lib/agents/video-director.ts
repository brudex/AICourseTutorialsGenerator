import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: videoDirectorAgent, Video Director, scene script,
 *   narration, sceneScriptSchema, LessonScene, lecture video
 *
 * WHAT:  Turns a written lesson into a lecture-video scene script (docs/11
 *        §3): ordered scenes, each with spoken narration and an exact
 *        on-screen spec, stored as LessonScene rows on the CURRENT version.
 * WHY:   This is the script-first step that makes Udemy-style video a
 *        rendering problem, not a writing problem. It merges the blueprint's
 *        Narration Writer (written → spoken language, §13) and Video Director
 *        (§15) because narration and visuals must be decided together to stay
 *        in sync. Estimated durations come from word count until real audio
 *        exists (step 7).
 * WHERE: Registered as `videoDirector`; runs after lessonWriter per lesson.
 */

import { AiCapability, LessonKind } from '@/generated/prisma'
import { NARRATION_WORDS_PER_MINUTE, estimateNarrationMs, sceneScriptSchema, type CourseBrief } from '@/lib/types'
import { learnerLevelGuide } from '@/lib/config/learner-levels'
import { hasRouteFor } from '@/lib/ai'
import * as lessonService from '@/services/lesson.service'
import { defineAgent } from './define-agent'
import { MAX_ILLUSTRATIONS_PER_LESSON } from './illustrator'
import {
  describeBriefForPrompt,
  describeLessonContentForPrompt,
  describeLessonPlacement,
  lessonAgentInputSchema,
  loadCurrentLessonContent,
  loadLessonContext,
} from './course-context'

/* How many pictures a lecture gets, by learner level (the welcome video: one). */
function illustrationRange(context: { lesson: { kind: LessonKind }; brief: CourseBrief }): string {
  if (context.lesson.kind === LessonKind.WELCOME) return '1'
  const { min, max } = learnerLevelGuide(context.brief.audienceProfile.level).illustrations
  const top = Math.min(max, MAX_ILLUSTRATIONS_PER_LESSON)
  return min >= top ? String(top) : `${min} to ${top}`
}

export const videoDirectorAgent = defineAgent({
  name: 'Video Director',
  description: 'Writes the lecture video: scenes, spoken narration, diagrams, code walkthroughs, demos',
  capability: AiCapability.STRONG_REASONING,
  inputSchema: lessonAgentInputSchema,
  outputSchema: sceneScriptSchema,
  schemaName: 'scene_script',
  temperature: 0.5,
  maxOutputTokens: 8_000,
  lessonIdOf: (input) => input.lessonId,

  loadContext: async (db, input, job) => {
    const context = await loadLessonContext(db, job.organizationId, input)
    const written = await loadCurrentLessonContent(db, input.lessonId)
    /* Pictures only when an image model is routed; otherwise diagrams only. */
    const canIllustrate = await hasRouteFor(db, job.organizationId, AiCapability.IMAGE_GENERATION)
    return { ...context, written, canIllustrate }
  },

  buildMessages: (context) => [
    {
      role: 'system',
      content: [
        'You are the director and scriptwriter of a professionally produced online course video.',
        'Turn the written lesson into a lecture video made of scenes. Each scene has spoken `narration` and an exact `onScreen` spec for its `type`.',
        'Scene types:',
        '- TITLE_CARD: lesson title (must be the first scene).',
        '- TALKING_POINTS: a heading and 1–6 short bullets that appear as they are mentioned.',
        '- DIAGRAM: valid Mermaid source (flowchart, sequenceDiagram, stateDiagram, classDiagram, or graph) showing the idea; keep labels short. Write one statement per line with real line breaks (never `;` or `<br>` between statements). Wrap labels containing ( ) [ ] : # & or line breaks in double quotes, e.g. A["Profit (loss)"]. Every subgraph needs a name. No style, classDef, class or click lines: the slide theme colours the diagram.',
        '- CODE_WALKTHROUGH: complete code plus steps that highlight line ranges (1-based, within the code) while the narration explains them.',
        '- CODE_TYPING: a live demo — `typedCode` is typed into `fileName` (after `initialCode`); `result` is what running it shows.',
        '- COMPARISON: two columns (e.g. wrong vs right, before vs after).',
        '- CALLOUT: one tip, warning, common mistake, or key idea.',
        '- EXERCISE_PROMPT: invites the learner to pause and try something.',
        '- QUIZ_BREAK: one quick question with options, the correct index, and an explanation.',
        ...(context.canIllustrate
          ? [
              '- ILLUSTRATION: a picture that is drawn for the video. `prompt` describes exactly what it shows (people, setting, objects, action), never text or labels; `caption` is one short line shown under it.',
            ]
          : []),
        '- SUMMARY: recap points (must be the last scene).',
        'Rules:',
        '- Narration is written for the ear: conversational, second person, short sentences, no markdown, no reading code symbol-by-symbol. It explains what is on screen at that moment.',
        '- Never put a long paragraph on screen — the screen shows keywords, diagrams, and code; the voice explains.',
        '- Use the lesson’s code samples for code scenes, unchanged, so on-screen code matches the downloads.',
        ...(context.canIllustrate
          ? [
              `- Every lecture includes ${illustrationRange(context)} ILLUSTRATION scenes (never more than ${MAX_ILLUSTRATIONS_PER_LESSON}). Use them for the opening hook or story, real-world examples, and the people, places, objects or situations the narration describes (for example a trader recording a sale, a busy market, a map lesson outdoors). Add them even when the lesson has no illustration request.`,
              '- Turn each illustration request into a scene: a DIAGRAM for processes, flows, structures and relationships; an ILLUSTRATION for real people, places, objects or situations.',
              '- In ILLUSTRATION prompts, show people and settings that match the course’s audience and region from the brief, and keep the picture free of any writing.',
            ]
          : ['- Turn each illustration request into a DIAGRAM or COMPARISON scene. Do not use ILLUSTRATION scenes.']),
        '- Vary the visuals; do not use more than two TALKING_POINTS scenes in a row.',
        '- Include at least one CALLOUT or COMPARISON for common mistakes and one EXERCISE_PROMPT or QUIZ_BREAK.',
        '- `emphasis` lists words in the narration to highlight; `pauseAfterMs` is 300–1200 between ideas.',
        `- Total narration should fit the lesson’s stated minutes at about ${Math.round(NARRATION_WORDS_PER_MINUTE * learnerLevelGuide(context.brief.audienceProfile.level).narration.speedFactor)} spoken words per minute.`,
        '- Pitch every scene to the AUDIENCE SPECIALIZATION in the brief: narration vocabulary and sentence length, on-screen wording, examples, pacing and quiz breaks all match that learner level.',
        '- Write narration and on-screen text in the requested language.',
        ...(context.lesson.kind === 'WELCOME'
          ? [
              `This is the course WELCOME video: 6–10 scenes, about 2 minutes, friendly and direct. Use TITLE_CARD, TALKING_POINTS, DIAGRAM (the course journey section by section)${context.canIllustrate ? ', one ILLUSTRATION of the learners this course is for' : ''} and SUMMARY; no code walkthroughs, exercise prompts or quiz breaks.`,
            ]
          : []),
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        'Course brief:',
        describeBriefForPrompt(context.brief),
        '',
        'Where this lesson sits:',
        describeLessonPlacement(context),
        '',
        'Written lesson:',
        describeLessonContentForPrompt(context.written.content),
      ].join('\n'),
    },
  ],

  persist: async (db, { input, output, context, execution }) => {
    await lessonService.replaceVersionScenes(
      db,
      context.written.versionId,
      output.scenes.map((scene, position) => ({
        organizationId: execution.job.organizationId,
        lessonId: input.lessonId,
        lessonVersionId: context.written.versionId,
        position,
        type: scene.type,
        narration: scene.narration,
        onScreen: scene.onScreen,
        emphasis: scene.emphasis,
        pauseAfterMs: scene.pauseAfterMs,
        estimatedDurationMs: estimateNarrationMs(scene.narration, scene.pauseAfterMs),
        createdByTaskId: execution.task.id,
      }))
    )
    const totalMs = output.scenes.reduce((sum, s) => sum + estimateNarrationMs(s.narration, s.pauseAfterMs), 0)
    return { scenes: output.scenes.length, estimatedMinutes: Math.round((totalMs / 60_000) * 10) / 10 }
  },
})
