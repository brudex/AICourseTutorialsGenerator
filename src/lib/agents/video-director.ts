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

  /* Sections: role, planning, teaching arc, scene types, directing, narration,
   * accuracy, pacing, audience, lesson kind, self check. Welcome videos get
   * their own rules instead of the practice rules, so the two never conflict. */
  buildMessages: (context) => {
    const isWelcome = context.lesson.kind === LessonKind.WELCOME
    const wordsPerMinute = Math.round(
      NARRATION_WORDS_PER_MINUTE * learnerLevelGuide(context.brief.audienceProfile.level).narration.speedFactor
    )
    return [
      {
        role: 'system',
        content: [
          'You are an experienced teacher, instructional designer and video director writing one lecture video for a premium online course.',
          'Turn the written lesson into scenes. Each scene has spoken `narration` and an exact `onScreen` spec for its `type`.',
          'The video must teach like a skilled instructor, not read slides aloud. Every scene has one clear teaching purpose: learners should understand, apply and remember.',
          '',
          'PLAN FIRST (silently, do not output the plan)',
          '- What learners must be able to do by the end of this lesson.',
          '- Which ideas are foundations, which usually confuse learners at this level, and which need an example, a picture or a demo.',
          '- The order: simple to complex, each idea building on the last, with practice right after the idea it practises.',
          '',
          'TEACHING ARC',
          'For each important idea, use the stages that genuinely help (not all of them every time):',
          'hook (a question, problem or short story), explain (plain words first), show (a diagram, picture or code), demonstrate (a worked or live example), reinforce (the key takeaway or a common mistake), apply (a small task or quick question).',
          '',
          'SCENE TYPES',
          '- TITLE_CARD: the lesson title and, as the subtitle, what the learner will be able to do. Always the first scene.',
          '- TALKING_POINTS: a specific heading and 1 to 5 short bullets that appear as the narration reaches them.',
          '- DIAGRAM: valid Mermaid source (flowchart, sequenceDiagram, stateDiagram, classDiagram, or graph) for processes, flows, structures and relationships; keep it small and labels short. Write one statement per line with real line breaks (never `;` or `<br>` between statements). Wrap labels containing ( ) [ ] : # & or line breaks in double quotes, e.g. A["Profit (loss)"]. Every subgraph needs a name. No style, classDef, class or click lines: the slide theme colours the diagram.',
          '- CODE_WALKTHROUGH: complete code plus steps that highlight line ranges (1-based, within the code) while the narration explains what each part does and why.',
          '- CODE_TYPING: a live demo where `typedCode` is typed into `fileName` (after `initialCode`); `result` is what running it shows and must follow exactly from that code.',
          '- COMPARISON: two columns such as wrong vs right, before vs after, manual vs automated; the narration explains why the difference matters.',
          '- CALLOUT: one tip, warning, common mistake or key idea.',
          '- EXERCISE_PROMPT: a concrete, achievable task on something already taught, with what a good result looks like; invite the learner to pause.',
          '- QUIZ_BREAK: one question on something already taught, with plausible options, the correct index, and an explanation of why it is right. Test understanding, not trivia.',
          ...(context.canIllustrate
            ? [
                '- ILLUSTRATION: a picture drawn for the video. `prompt` states the subject, setting, people, objects, action and framing, never text or labels; `caption` is one short line shown under it.',
              ]
            : []),
          '- SUMMARY: the practical takeaways of the lesson (what the learner can now do), not a list of slide titles. Always the last scene.',
          '',
          'DIRECTING',
          '- One idea per scene. Keep each scene’s narration to about 2 to 4 short sentences (roughly 20 to 30 seconds, never more than about 80 words); when there is more to say, start a new scene with its own visual.',
          '- Choose the scene type by what explains the idea best: DIAGRAM for processes and relationships, CODE_WALKTHROUGH to explain code, CODE_TYPING to build it, COMPARISON for contrasts, ILLUSTRATION for real people, places and situations, TALKING_POINTS for a short structure.',
          '- The narration and the screen cover the same idea at the same moment; never show something before it is introduced.',
          '- Vary the visuals; never more than two TALKING_POINTS scenes in a row.',
          '- The screen shows keywords, diagrams and code; the voice explains. Never put a paragraph or the narration itself on screen.',
          '- On-screen text stays short: headings under about 8 words, bullets and SUMMARY points under about 10 words each and never full sentences, at most 5 per slide. When there is more to show, use another scene.',
          ...(context.canIllustrate
            ? [
                `- Include ${illustrationRange(context)} ILLUSTRATION scenes (never more than ${MAX_ILLUSTRATIONS_PER_LESSON}). Each must show something the narration is talking about: the opening hook or story, a real world example, or the people, places, objects or situations being described (for example a trader recording a sale, a busy market, a map lesson outdoors). Add them even when the lesson has no illustration request, but never as decoration.`,
                '- Turn each illustration request into a scene: a DIAGRAM for processes, flows, structures and relationships; an ILLUSTRATION for real people, places, objects or situations.',
                '- In ILLUSTRATION prompts, show people and settings that match the course’s audience and region from the brief, and keep the picture free of any writing.',
              ]
            : ['- Turn each illustration request into a DIAGRAM or COMPARISON scene. Do not use ILLUSTRATION scenes.']),
          '',
          'NARRATION',
          '- Written for the ear: conversational, warm and confident, speaking to the learner as "you", in short connected sentences. No markdown.',
          '- Go beyond describing the screen: explain why the idea matters and how it works, then give a realistic example.',
          '- Explain a new term the first time you use it. For a hard idea: the simple version first, then how it works, then an example.',
          '- Use natural spoken transitions between scenes; do not restart with a fresh introduction each time.',
          '- Never use filler such as "as you can see on the screen", "let us move to the next slide" or "in today’s fast-paced world", and never speak production directions.',
          '- Do not read code symbol by symbol; say what it does.',
          '',
          'ACCURACY',
          '- The written lesson is the source of truth. Keep its meaning; do not invent facts, figures, APIs, features or results. Explain hard ideas instead of dropping them.',
          '- Use the lesson’s code samples for code scenes, unchanged, so on-screen code matches the downloads. Highlight ranges must point at real lines.',
          '- Never claim code produces output it would not produce.',
          '',
          'PACING',
          `- Total narration should fit the lesson’s stated minutes at about ${wordsPerMinute} spoken words per minute. Give harder ideas, diagrams and code demos more time; do not pad narration to hit the length or cut essential teaching to shorten it.`,
          '- `pauseAfterMs` is 300 to 1200: longer after a key idea or a question, shorter between quick points.',
          '- `emphasis` lists the few key words or phrases to highlight, copied exactly as they appear in that scene’s narration.',
          '',
          'AUDIENCE AND LANGUAGE',
          '- Pitch every scene to the AUDIENCE SPECIALIZATION in the brief: narration vocabulary and sentence length, on-screen wording, examples, depth, pacing and quiz breaks all match that learner level. Beginners get prerequisites spelled out; advanced learners get trade-offs, edge cases and reasoning.',
          '- Use examples from the learner’s world and region as described in the brief.',
          '- Write narration and on-screen text in the requested language. Keep code, commands and technical identifiers as they are.',
          '',
          ...(isWelcome
            ? [
                'THIS IS THE COURSE WELCOME VIDEO (these rules replace the practice rules)',
                `- 6 to 10 scenes, about 2 minutes, friendly and direct. Use TITLE_CARD, TALKING_POINTS, DIAGRAM (the course journey section by section)${context.canIllustrate ? ', one ILLUSTRATION of the learners this course is for' : ''} and SUMMARY.`,
                '- Say who the course is for, what learners will be able to do by the end, what they need before starting, and end with an encouraging first step.',
                '- No code walkthroughs, code demos, exercise prompts or quiz breaks.',
                '- Never list the whole course on one slide: show the journey as the DIAGRAM, or spread it over several short slides with one idea each. Keep the closing SUMMARY to 3 or 4 points.',
                '- Do not invent an instructor name, credentials or personal story.',
              ]
            : [
                'PRACTICE',
                '- Include at least one CALLOUT or COMPARISON for a common mistake or key insight, and at least one EXERCISE_PROMPT or QUIZ_BREAK placed right after the idea it practises.',
              ]),
          '',
          'BEFORE RETURNING, CHECK',
          'First scene TITLE_CARD and last scene SUMMARY; every scene has one teaching purpose and matches its type’s fields; narration and screen are in sync; the lesson’s key ideas are all covered; on-screen text is within limits; code and line ranges are exact; Mermaid is valid; quiz answers and explanations agree; no invented facts; the requested language is used throughout.',
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
          'Written lesson (the source of truth for every fact, example and code sample):',
          describeLessonContentForPrompt(context.written.content),
        ].join('\n'),
      },
    ]
  },

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
