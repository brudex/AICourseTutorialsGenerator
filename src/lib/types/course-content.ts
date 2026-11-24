/**
 * SOURCE OF TRUTH KEYWORDS: CourseState, courseBriefSchema, CourseBrief,
 *   learningOutcomeSchema, researchDossierContentSchema, curriculumSchema,
 *   lessonContentSchema, lessonSectionSchema, exerciseContentSchema,
 *   assessmentItemContentSchema, qaReportSchema, generationScopeSchema
 *
 * WHAT:  The Zod contracts (and inferred types) for every Json column of
 *        Course State — the brief, research dossier, curriculum, lesson
 *        content, exercises, assessment items, QA reports, and regeneration
 *        scopes.
 * WHY:   One schema is used three ways: as the LLM structured-output contract
 *        (the AI Gateway converts it to JSON Schema), as the validator on every
 *        DB read/write of the Json column, and as the form contract in the UI.
 *        So the model's output, the database, and the editor cannot drift.
 *        LLM-produced fields use `.nullable()` rather than `.optional()`:
 *        strict JSON-Schema modes on OpenAI-compatible providers require every
 *        key to be present, and "present but null" survives that.
 *        Enums that exist in Prisma (ExerciseLevel, AssessmentType,
 *        AssessmentDifficulty) are taken from the generated client, never
 *        re-listed here.
 * WHERE: Prisma Json columns on Course, ResearchDossier, LessonVersion,
 *        Exercise, AssessmentItem, GenerationJob (prisma/schema.prisma);
 *        agents (src/lib/agents), the AI Gateway (src/lib/ai), course routers,
 *        and course UI forms. Re-exported via src/lib/types.
 */

import { z } from 'zod'

import { AssessmentDifficulty, AssessmentType, ExerciseLevel, SceneType } from '@/generated/prisma'

import { audienceProfileSchema } from './audience'
import { expressionError } from '@/lib/math/expression'

/* Upper bounds keep a runaway generation (or a hostile paste) from writing
 * megabytes into a single Json cell. */
const SHORT_TEXT = 300
const LONG_TEXT = 20_000
const CODE_TEXT = 20_000
export const SOURCE_MATERIAL_MAX = 50_000

/**
 * SOURCE OF TRUTH KEYWORDS: courseDifficultySchema, CourseDifficulty,
 *   COURSE_DIFFICULTIES
 *
 * WHAT:  How much the learners already know about THIS topic (beginner to
 *        advanced), separate from who they are (CourseBrief.audienceProfile).
 * WHERE: CourseBrief.difficulty; read by every content agent's prompt.
 */
export const COURSE_DIFFICULTIES = ['beginner', 'intermediate', 'advanced'] as const
export const courseDifficultySchema = z.enum(COURSE_DIFFICULTIES)
export type CourseDifficulty = z.infer<typeof courseDifficultySchema>

/**
 * SOURCE OF TRUTH KEYWORDS: courseBriefSchema, CourseBrief, CourseIncludes,
 *   sourceMaterial, COURSE_DURATION_LIMITS
 *
 * WHAT:  The structured course request (blueprint §7) — what the brief form
 *        (and later the AI interview) produces and Course.brief stores.
 * WHY:   No `.default()`s: React Hook Form + zodResolver need input and output
 *        types to match, so the form supplies every value explicitly.
 *        `sourceMaterial` is the MVP 1 research grounding (decision D3) —
 *        optional pasted text the Research Agent must prefer over its own
 *        knowledge.
 * WHERE: Course.brief; courses.create / courses.update input; new-course form.
 */
export const COURSE_DURATION_LIMITS = { minMinutes: 15, maxMinutes: 2_400 } as const

/**
 * SOURCE OF TRUTH KEYWORDS: LECTURE_LIMITS, max lecture length, 20 minute
 *   lecture cap, split long lectures, attention span
 * WHAT:  The longest a single lecture (one video) may be.
 * WHY:   Short videos keep attention and give learners a steady sense of
 *        progress; longer topics become Part 1, Part 2, ... lectures.
 * WHERE: Curriculum Architect prompt and persist (splits), lesson editor
 *        forms (updateLessonSchema, createLessonSchema).
 */
export const LECTURE_LIMITS = { maxMinutes: 20 } as const

export const courseBriefSchema = z.object({
  topic: z.string().trim().min(3, 'Describe the topic in a few words.').max(200),
  description: z.string().trim().max(4_000),
  audience: z.string().trim().min(3, 'Who is this course for?').max(SHORT_TEXT),
  /* Learner level and refinements; shapes every agent (see audience.ts). */
  audienceProfile: audienceProfileSchema,
  difficulty: courseDifficultySchema,
  language: z.string().trim().min(2).max(60),
  teachingStyle: z.string().trim().max(SHORT_TEXT),
  targetDurationMinutes: z
    .number()
    .int()
    .min(COURSE_DURATION_LIMITS.minMinutes)
    .max(COURSE_DURATION_LIMITS.maxMinutes),
  includes: z.object({
    exercises: z.boolean(),
    quizzes: z.boolean(),
    projects: z.boolean(),
  }),
  sourceMaterial: z.string().max(SOURCE_MATERIAL_MAX),
})

export type CourseBrief = z.infer<typeof courseBriefSchema>
export type CourseIncludes = CourseBrief['includes']

/**
 * SOURCE OF TRUTH KEYWORDS: learningOutcomeSchema, LearningOutcome,
 *   objectiveRefSchema, LEARNING_OUTCOME_ID_PATTERN
 *
 * WHAT:  A course learning outcome with a stable id ("LO-1") that modules,
 *        lessons, and assessment items reference.
 * WHY:   Assessment items must connect to an objective (blueprint §18); an id
 *        survives outcome text edits where a text match would not.
 * WHERE: Course.outcomes; Module/Lesson.objectiveRefs; AssessmentItem.objectiveRef.
 */
export const LEARNING_OUTCOME_ID_PATTERN = /^LO-\d{1,3}$/
export const objectiveRefSchema = z.string().regex(LEARNING_OUTCOME_ID_PATTERN)

export const learningOutcomeSchema = z.object({
  id: objectiveRefSchema,
  text: z.string().trim().min(3).max(SHORT_TEXT),
})

export type LearningOutcome = z.infer<typeof learningOutcomeSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: researchDossierContentSchema,
 *   ResearchDossierContent, ResearchAgentOutput
 *
 * WHAT:  Research Agent output — the knowledge base lesson writers draw on.
 * WHY:   Stored separately from instructional content (blueprint §8).
 *        `caveats` is where the model records what it is unsure of or what
 *        may be out of date, so the UI can surface it instead of the
 *        uncertainty silently turning into lesson "facts".
 * WHERE: ResearchDossier.content; research agent output schema.
 */
export const researchDossierContentSchema = z.object({
  summary: z.string().max(LONG_TEXT),
  keyConcepts: z
    .array(z.object({ name: z.string().max(SHORT_TEXT), explanation: z.string().max(4_000) }))
    .max(60),
  prerequisites: z.array(z.string().max(SHORT_TEXT)).max(30),
  commonMistakes: z.array(z.string().max(1_000)).max(40),
  deprecatedApproaches: z.array(z.string().max(1_000)).max(30),
  terminology: z
    .array(z.object({ term: z.string().max(120), definition: z.string().max(1_000) }))
    .max(80),
  recommendedSequence: z.array(z.string().max(SHORT_TEXT)).max(60),
  exampleIdeas: z.array(z.string().max(1_000)).max(40),
  projectIdeas: z.array(z.string().max(1_000)).max(20),
  caveats: z.array(z.string().max(1_000)).max(30),
})

export type ResearchDossierContent = z.infer<typeof researchDossierContentSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: curriculumSchema, Curriculum, CurriculumModule,
 *   CurriculumLesson, CurriculumArchitectOutput, bookChapterRef, bookStartPage
 *
 * WHAT:  Curriculum Architect output (blueprint §9) — outcomes, module and
 *        lesson sequence with objective links and durations.
 * WHY:   Persisted by expanding into Course goal/outcomes + Module + Lesson
 *        (PLANNED) rows, which the user then edits and approves; the Json
 *        shape is only the agent contract.
 * WHERE: curriculumArchitect agent output; persisted via course services.
 */
/* Book-based courses: a module names its chapter (`CH-3`) and each lesson
 * the inclusive book pages it teaches; both are null without a course book. */
export const curriculumLessonSchema = z.object({
  title: z.string().trim().min(3).max(200),
  objectiveRefs: z.array(objectiveRefSchema).min(1).max(10),
  estimatedMinutes: z.number().int().min(2).max(240),
  bookStartPage: z.number().int().min(1).nullable(),
  bookEndPage: z.number().int().min(1).nullable(),
})

export const curriculumModuleSchema = z.object({
  title: z.string().trim().min(3).max(200),
  summary: z.string().max(2_000),
  objectiveRefs: z.array(objectiveRefSchema).min(1).max(20),
  estimatedMinutes: z.number().int().min(5).max(1_200),
  bookChapterRef: z.string().max(16).nullable(),
  lessons: z.array(curriculumLessonSchema).min(1).max(20),
})

export const curriculumSchema = z.object({
  title: z.string().trim().min(3).max(200),
  goal: z.string().max(2_000),
  outcomes: z.array(learningOutcomeSchema).min(1).max(30),
  prerequisites: z.array(z.string().max(SHORT_TEXT)).max(20),
  assessmentStrategy: z.string().max(4_000),
  modules: z.array(curriculumModuleSchema).min(1).max(30),
})

export type CurriculumLesson = z.infer<typeof curriculumLessonSchema>
export type CurriculumModule = z.infer<typeof curriculumModuleSchema>
export type Curriculum = z.infer<typeof curriculumSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: lessonSectionSchema, LessonSection,
 *   LessonSectionType, LESSON_SECTION_TYPES, lessonContentSchema,
 *   LessonContent, LessonWriterOutput
 *
 * WHAT:  Structured lesson content (blueprint §10) — an ordered list of typed
 *        sections plus objectives.
 * WHY:   Structured, not Markdown: each section type renders differently in
 *        the editor and in exports, and later MVPs map sections to scenes,
 *        narration, and visuals. `illustration_request` is stored now and
 *        rendered in MVP 2, so MVP 1 lessons are already visual-ready.
 * WHERE: LessonVersion.content; lessonWriter agent output; lesson editor.
 */
const textSection = <T extends string>(type: T) =>
  z.object({
    type: z.literal(type),
    heading: z.string().max(200).nullable(),
    body: z.string().min(1).max(LONG_TEXT),
  })

export const lessonSectionSchema = z.discriminatedUnion('type', [
  textSection('hook'),
  textSection('explanation'),
  textSection('analogy'),
  textSection('example'),
  textSection('summary'),
  z.object({
    type: z.literal('code_demo'),
    heading: z.string().max(200).nullable(),
    language: z.string().min(1).max(40),
    code: z.string().min(1).max(CODE_TEXT),
    explanation: z.string().max(LONG_TEXT),
  }),
  z.object({
    type: z.literal('common_mistakes'),
    heading: z.string().max(200).nullable(),
    items: z
      .array(z.object({ mistake: z.string().max(1_000), fix: z.string().max(2_000) }))
      .min(1)
      .max(15),
  }),
  z.object({
    type: z.literal('illustration_request'),
    kind: z.enum(['diagram', 'flowchart', 'comparison', 'timeline', 'illustration']),
    prompt: z.string().min(1).max(2_000),
    caption: z.string().max(SHORT_TEXT).nullable(),
  }),
  z.object({
    type: z.literal('further_learning'),
    heading: z.string().max(200).nullable(),
    items: z.array(z.string().max(SHORT_TEXT)).min(1).max(15),
  }),
])

export type LessonSection = z.infer<typeof lessonSectionSchema>
export type LessonSectionType = LessonSection['type']

export const lessonContentSchema = z.object({
  objectives: z.array(z.string().max(SHORT_TEXT)).min(1).max(10),
  estimatedMinutes: z.number().int().min(1).max(240),
  sections: z.array(lessonSectionSchema).min(2).max(60),
})

export type LessonContent = z.infer<typeof lessonContentSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: exerciseContentSchema, ExerciseContent,
 *   exerciseSetSchema, ExerciseSet, ExerciseDesignerOutput
 *
 * WHAT:  One exercise body (blueprint §17) and the Exercise Designer's output
 *        (a set, one row per item).
 * WHY:   Programming fields (starterCode, expectedOutput, tests) are nullable
 *        so the same shape serves non-code courses.
 * WHERE: Exercise.content; exerciseDesigner agent output.
 */
export const exerciseContentSchema = z.object({
  instructions: z.string().min(1).max(LONG_TEXT),
  estimatedMinutes: z.number().int().min(1).max(240),
  language: z.string().max(40).nullable(),
  starterCode: z.string().max(CODE_TEXT).nullable(),
  expectedOutput: z.string().max(4_000).nullable(),
  hints: z.array(z.string().max(1_000)).max(8),
  solution: z.string().min(1).max(CODE_TEXT),
  tests: z.string().max(CODE_TEXT).nullable(),
})

export type ExerciseContent = z.infer<typeof exerciseContentSchema>

export const exerciseSetSchema = z.object({
  exercises: z
    .array(
      z.object({
        level: z.enum(ExerciseLevel),
        title: z.string().trim().min(3).max(200),
        content: exerciseContentSchema,
      })
    )
    .min(1)
    .max(10),
})

export type ExerciseSet = z.infer<typeof exerciseSetSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: assessmentItemContentSchema,
 *   AssessmentItemContent, assessmentOptionSchema, assessmentSetSchema,
 *   AssessmentSet, AssessmentDesignerOutput
 *
 * WHAT:  One assessment question, discriminated by `type` (the Prisma
 *        AssessmentType enum), and the Assessment Designer's output set.
 * WHY:   Every variant carries an `explanation` so learners see WHY an answer
 *        is right. AssessmentItem.type is written from `content.type`, so the
 *        column and the Json can never disagree.
 * WHERE: AssessmentItem.content; assessmentDesigner agent output.
 */
export const assessmentOptionSchema = z.object({
  id: z.string().min(1).max(8),
  text: z.string().min(1).max(1_000),
})

const explanation = z.string().min(1).max(4_000)
const options = z.array(assessmentOptionSchema).min(2).max(6)

export const assessmentItemContentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(AssessmentType.MULTIPLE_CHOICE),
    question: z.string().min(1).max(2_000),
    options,
    correctOptionId: z.string().min(1).max(8),
    explanation,
  }),
  z.object({
    type: z.literal(AssessmentType.MULTIPLE_RESPONSE),
    question: z.string().min(1).max(2_000),
    options,
    correctOptionIds: z.array(z.string().min(1).max(8)).min(1).max(6),
    explanation,
  }),
  z.object({
    type: z.literal(AssessmentType.TRUE_FALSE),
    statement: z.string().min(1).max(2_000),
    answer: z.boolean(),
    explanation,
  }),
  z.object({
    type: z.literal(AssessmentType.SHORT_ANSWER),
    question: z.string().min(1).max(2_000),
    sampleAnswer: z.string().min(1).max(4_000),
    rubric: z.array(z.string().max(500)).min(1).max(8),
    explanation,
  }),
  z.object({
    type: z.literal(AssessmentType.FILL_BLANK),
    /* Blanks are written as "___" in order; answers[i] fills blank i. */
    text: z.string().min(1).max(2_000),
    answers: z.array(z.string().min(1).max(200)).min(1).max(10),
    explanation,
  }),
  z.object({
    type: z.literal(AssessmentType.MATCHING),
    prompt: z.string().min(1).max(2_000),
    pairs: z
      .array(z.object({ left: z.string().min(1).max(300), right: z.string().min(1).max(300) }))
      .min(2)
      .max(10),
    explanation,
  }),
  z.object({
    type: z.literal(AssessmentType.SCENARIO),
    scenario: z.string().min(1).max(4_000),
    question: z.string().min(1).max(2_000),
    options,
    correctOptionId: z.string().min(1).max(8),
    explanation,
  }),
])

export type AssessmentItemContent = z.infer<typeof assessmentItemContentSchema>

export const assessmentSetSchema = z
  .object({
    items: z
      .array(
        z.object({
          objectiveRef: objectiveRefSchema,
          difficulty: z.enum(AssessmentDifficulty),
          content: assessmentItemContentSchema,
        })
      )
      .min(1)
      .max(30),
  })
  /* Answer keys must point at real options — caught here so the gateway's
   * repair turn can fix it instead of a broken quiz reaching learners. */
  .superRefine((set, ctx) => {
    set.items.forEach((item, index) => {
      const c = item.content
      const optionIds = 'options' in c ? new Set(c.options.map((o) => o.id)) : null
      if ((c.type === 'MULTIPLE_CHOICE' || c.type === 'SCENARIO') && optionIds && !optionIds.has(c.correctOptionId)) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'content', 'correctOptionId'], message: 'correctOptionId must match one of the option ids' })
      }
      if (c.type === 'MULTIPLE_RESPONSE' && optionIds && c.correctOptionIds.some((id) => !optionIds.has(id))) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'content', 'correctOptionIds'], message: 'every correctOptionIds entry must match an option id' })
      }
      /* A blank is any run of 3+ underscores: models often write "______". */
      if (c.type === 'FILL_BLANK' && (c.text.match(/_{3,}/g)?.length ?? 0) !== c.answers.length) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'content', 'answers'], message: 'answers must have one entry per ___ blank in text' })
      }
    })
  })

export type AssessmentSet = z.infer<typeof assessmentSetSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: qaReportSchema, QaReport, QaIssue,
 *   QA_ISSUE_CATEGORIES, QaReviewerOutput
 *
 * WHAT:  QA Reviewer output (blueprint §20) — a verdict plus located issues.
 * WHY:   `revise` triggers one lessonWriter fix task carrying these issues;
 *        `location` points at a section index or item so the editor can
 *        highlight it.
 * WHERE: qaReviewer / courseQa agent output; stored on AgentTask.output.
 */
export const QA_ISSUE_CATEGORIES = [
  'factual_accuracy',
  'code_correctness',
  'curriculum_alignment',
  'repetition',
  'difficulty',
  'clarity',
  'quiz_correctness',
  'grammar',
  'copyright',
] as const

export const qaIssueSchema = z.object({
  severity: z.enum(['low', 'medium', 'high']),
  category: z.enum(QA_ISSUE_CATEGORIES),
  location: z.string().max(200),
  message: z.string().min(1).max(2_000),
  suggestedFix: z.string().max(4_000).nullable(),
})

export const qaReportSchema = z.object({
  verdict: z.enum(['pass', 'revise']),
  issues: z.array(qaIssueSchema).max(40),
})

export type QaIssue = z.infer<typeof qaIssueSchema>
export type QaReport = z.infer<typeof qaReportSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: generationScopeSchema, GenerationScope,
 *   RegenerateTarget, selectiveRegeneration
 *
 * WHAT:  What a REGENERATE job targets (blueprint §36 selective regeneration).
 * WHY:   A discriminated union, so the orchestrator's DAG builder switches on
 *        `target` exhaustively — a new scope fails to compile until handled.
 * WHERE: GenerationJob.scope; courses.generate input.
 */
export const generationScopeSchema = z.discriminatedUnion('target', [
  z.object({ target: z.literal('lesson'), lessonId: z.string().min(1) }),
  z.object({ target: z.literal('lessonExercises'), lessonId: z.string().min(1) }),
  z.object({ target: z.literal('lessonQuiz'), lessonId: z.string().min(1) }),
  z.object({ target: z.literal('module'), moduleId: z.string().min(1) }),
])

export type GenerationScope = z.infer<typeof generationScopeSchema>
export type RegenerateTarget = GenerationScope['target']

/**
 * SOURCE OF TRUTH KEYWORDS: createCourseSchema, CreateCourseValues,
 *   updateCourseSchema, UpdateCourseValues, courseIdSchema,
 *   courseDetailsSchema, CourseDetailsValues, edit course title description
 *
 * WHAT:  Router inputs for creating, editing, and addressing a course.
 * WHY:   The brief form submits `createCourseSchema` directly; the course
 *        title starts as the brief topic. Afterwards the author edits the
 *        details learners see (title, subtitle, description) and who the
 *        course is for (audienceProfile, merged into the stored brief so
 *        every later generation follows it). `courseDetailsSchema` is the
 *        edit form; `updateCourseSchema` adds the course address. Empty
 *        subtitle or description clears it.
 * WHERE: courses router; new-course form; EditCourseDialog.
 */
export const courseIdSchema = z.object({
  organizationId: z.string().min(1),
  courseId: z.string().min(1),
})

/**
 * SOURCE OF TRUTH KEYWORDS: listCoursesSchema, ListCoursesValues, course search,
 *   courses pagination, COURSES_PAGE_SIZE
 * WHAT:  courses.list input: page, page size and an optional title search.
 * WHERE: courses.list; CoursesList.
 */
export const COURSES_PAGE_SIZE = 10
export const listCoursesSchema = z.object({
  organizationId: z.string().min(1),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().max(100).optional(),
  search: z.string().trim().max(120).optional(),
})
export type ListCoursesValues = z.infer<typeof listCoursesSchema>

export const createCourseSchema = z.object({
  organizationId: z.string().min(1),
  brief: courseBriefSchema,
})

export const courseDetailsSchema = z.object({
  title: z.string().trim().min(3, 'Give the course a title.').max(200),
  subtitle: z.string().trim().max(120, 'Keep the subtitle to 120 characters.'),
  description: z.string().trim().max(5_000),
  audienceProfile: audienceProfileSchema,
})

export const updateCourseSchema = courseIdSchema.extend(courseDetailsSchema.shape)

export type CourseDetailsValues = z.infer<typeof courseDetailsSchema>

export type CourseIdValues = z.infer<typeof courseIdSchema>
export type CreateCourseValues = z.infer<typeof createCourseSchema>
export type UpdateCourseValues = z.infer<typeof updateCourseSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: generateCourseSchema, GenerateCourseValues,
 *   approveCourseSchema, ApproveCourseValues, COURSE_APPROVAL_STAGES
 *
 * WHAT:  Start a generation job for a course; approve a checkpoint.
 * WHY:   `kind` is a discriminated union so each later job kind (BUILD_COURSE,
 *        REGENERATE with a scope) adds a variant the router must handle.
 *        Approval stages grow the same way.
 * WHERE: courses.generate / courses.approve.
 */
/* RESUME_BUILD is an action, not a job kind: it queues a BUILD_COURSE job
 * with only the missing work (enqueueResumeBuild). */
export const GENERATE_COURSE_KINDS = ['PLAN_COURSE', 'BUILD_COURSE', 'RESUME_BUILD', 'RENDER_VISUALS', 'RENDER_NARRATION', 'RENDER_VIDEO', 'BUILD_MATERIALS', 'EXPORT_COURSE', 'EXPORT_SCORM'] as const
export const generateCourseSchema = courseIdSchema.extend({
  kind: z.enum(GENERATE_COURSE_KINDS),
})

export const COURSE_APPROVAL_STAGES = ['curriculum'] as const
export const approveCourseSchema = courseIdSchema.extend({
  stage: z.enum(COURSE_APPROVAL_STAGES),
})

export type GenerateCourseValues = z.infer<typeof generateCourseSchema>
export type ApproveCourseValues = z.infer<typeof approveCourseSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: curriculum editing schemas, updateModuleSchema,
 *   updateLessonSchema, createLessonSchema, createModuleSchema,
 *   moveCurriculumItemSchema, deleteCurriculumItemSchema
 *
 * WHAT:  Inputs for editing an unapproved curriculum (blueprint §29: rename,
 *        add, delete, reorder, change durations).
 * WHERE: curriculum router; curriculum editor.
 */
export const updateModuleSchema = courseIdSchema.extend({
  moduleId: z.string().min(1),
  title: z.string().trim().min(3, 'Module title is too short.').max(200),
  summary: z.string().trim().max(2_000),
})

export const createModuleSchema = courseIdSchema.extend({
  title: z.string().trim().min(3, 'Module title is too short.').max(200),
})

export const updateLessonSchema = courseIdSchema.extend({
  lessonId: z.string().min(1),
  title: z.string().trim().min(3, 'Lesson title is too short.').max(200),
  estimatedMinutes: z
    .number()
    .int()
    .min(1, 'At least 1 minute.')
    .max(LECTURE_LIMITS.maxMinutes, `Keep a lecture to ${LECTURE_LIMITS.maxMinutes} minutes or less. Split longer topics.`),
})

export const createLessonSchema = courseIdSchema.extend({
  moduleId: z.string().min(1),
  title: z.string().trim().min(3, 'Lesson title is too short.').max(200),
  estimatedMinutes: z
    .number()
    .int()
    .min(1)
    .max(LECTURE_LIMITS.maxMinutes, `Keep a lecture to ${LECTURE_LIMITS.maxMinutes} minutes or less. Split longer topics.`),
})

export const moveCurriculumItemSchema = courseIdSchema.extend({
  itemType: z.enum(['module', 'lesson']),
  itemId: z.string().min(1),
  direction: z.enum(['up', 'down']),
})

export const deleteCurriculumItemSchema = courseIdSchema.extend({
  itemType: z.enum(['module', 'lesson']),
  itemId: z.string().min(1),
})

export type UpdateModuleValues = z.infer<typeof updateModuleSchema>
export type CreateModuleValues = z.infer<typeof createModuleSchema>
export type UpdateLessonValues = z.infer<typeof updateLessonSchema>
export type CreateLessonValues = z.infer<typeof createLessonSchema>
export type MoveCurriculumItemValues = z.infer<typeof moveCurriculumItemSchema>
export type DeleteCurriculumItemValues = z.infer<typeof deleteCurriculumItemSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: sceneSchema, Scene, SceneOnScreen,
 *   sceneScriptSchema, SceneScript, VideoDirectorOutput, NARRATION_WORDS_PER_MINUTE,
 *   estimateNarrationMs
 *
 * WHAT:  The lecture-video scene script (docs/11 §3) — the contract between
 *        the Video Director agent and the deterministic renderer.
 * WHY:   Discriminated by `type` (the Prisma SceneType enum) so each layout
 *        carries exactly the on-screen data its renderer template needs.
 *        Narration is a separate field written for the ear. Semantic rules
 *        (highlight ranges inside the code, valid quiz answer, opening title
 *        card, closing summary) live in superRefine so the gateway's repair
 *        turn can fix them.
 * WHERE: Video Director output; LessonScene rows (narration + onScreen);
 *        lesson Script tab; the renderer (step 8).
 */
export const NARRATION_WORDS_PER_MINUTE = 150

export function estimateNarrationMs(narration: string, pauseAfterMs: number): number {
  const words = narration.trim().split(/\s+/).filter(Boolean).length
  return Math.round((words / NARRATION_WORDS_PER_MINUTE) * 60_000) + pauseAfterMs
}

const heading = z.string().min(1).max(120)
const sceneCommon = {
  narration: z.string().min(1).max(1_500),
  emphasis: z.array(z.string().min(1).max(60)).max(8),
  pauseAfterMs: z.number().int().min(0).max(3_000),
}

/**
 * SOURCE OF TRUTH KEYWORDS: fitHighlightLines, code walkthrough highlight,
 *   startLine endLine clamp, video director invalid output, line range repair
 * WHAT:  Puts each code-walkthrough step's highlight inside the code: swaps a
 *        reversed range and clamps it to 1..line count.
 * WHY:   Models often miscount lines; failing the whole scene script (three
 *        retries, then the lesson) over a highlight range lost whole lessons.
 *        A preprocess keeps the JSON Schema sent to the model unchanged.
 * WHERE: The CODE_WALKTHROUGH onScreen schema in sceneSchema.
 */
const looseWalkthroughSchema = z.looseObject({
  code: z.string(),
  steps: z.array(z.looseObject({ startLine: z.number(), endLine: z.number() })),
})

function fitHighlightLines(walkthrough: z.output<typeof looseWalkthroughSchema>) {
  const lineCount = Math.max(1, walkthrough.code.split('\n').length)
  const clamp = (line: number) => Math.min(Math.max(Math.round(line), 1), lineCount)
  return {
    ...walkthrough,
    steps: walkthrough.steps.map((step) => {
      const start = clamp(Math.min(step.startLine, step.endLine))
      return { ...step, startLine: start, endLine: Math.max(start, clamp(Math.max(step.startLine, step.endLine))) }
    }),
  }
}

export const sceneSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal(SceneType.TITLE_CARD),
    ...sceneCommon,
    onScreen: z.object({ title: heading, subtitle: z.string().max(200).nullable() }),
  }),
  z.object({
    type: z.literal(SceneType.TALKING_POINTS),
    ...sceneCommon,
    onScreen: z.object({ heading, bullets: z.array(z.string().min(1).max(140)).min(1).max(6) }),
  }),
  z.object({
    type: z.literal(SceneType.DIAGRAM),
    ...sceneCommon,
    onScreen: z.object({
      heading,
      /* Mermaid source — rendered to SVG deterministically in step 6. */
      mermaid: z.string().min(1).max(4_000),
      caption: z.string().max(200).nullable(),
    }),
  }),
  z.object({
    type: z.literal(SceneType.ILLUSTRATION),
    ...sceneCommon,
    onScreen: z.object({
      heading,
      /* What the picture shows (people, place, objects, action), written for an
       * image model; the Illustrator adds the house style. No text in images. */
      prompt: z.string().min(10).max(1_500),
      caption: z.string().max(200).nullable(),
    }),
  }),
  z.object({
    type: z.literal(SceneType.GRAPH),
    ...sceneCommon,
    onScreen: z.object({
      heading,
      xLabel: z.string().max(40).nullable(),
      yLabel: z.string().max(40).nullable(),
      xMin: z.number(),
      xMax: z.number(),
      /* null: fitted to the curves. */
      yMin: z.number().nullable(),
      yMax: z.number().nullable(),
      curves: z
        .array(
          z.object({
            /* A formula in x, e.g. "(x^2 - 4)/(x - 2)" — drawn by src/lib/math/graph.ts, never run as code. */
            expression: z
              .string()
              .min(1)
              .max(200)
              .superRefine((value, ctx) => {
                const error = expressionError(value)
                if (error) ctx.addIssue({ code: 'custom', message: `Formula does not parse: ${error}` })
              }),
            label: z.string().max(60).nullable(),
          })
        )
        .min(1)
        .max(4),
      /* open: a hole (an open circle where the function is not defined). */
      points: z.array(z.object({ x: z.number(), y: z.number(), label: z.string().max(40).nullable(), open: z.boolean() })).max(8),
      /* Dashed lines: axis "x" is the vertical line x = value, "y" the horizontal line y = value. */
      guides: z.array(z.object({ axis: z.enum(['x', 'y']), value: z.number(), label: z.string().max(40).nullable() })).max(4),
      caption: z.string().max(200).nullable(),
    }),
  }),
  z.object({
    type: z.literal(SceneType.CODE_WALKTHROUGH),
    ...sceneCommon,
    onScreen: z.preprocess(
      (value) => {
        const walkthrough = looseWalkthroughSchema.safeParse(value)
        return walkthrough.success ? fitHighlightLines(walkthrough.data) : value
      },
      z.object({
        heading,
        language: z.string().min(1).max(40),
        code: z.string().min(1).max(6_000),
        steps: z
          .array(
            z.object({
              startLine: z.number().int().min(1),
              endLine: z.number().int().min(1),
              note: z.string().min(1).max(200),
            })
          )
          .min(1)
          .max(8),
      })
    ),
  }),
  z.object({
    type: z.literal(SceneType.CODE_TYPING),
    ...sceneCommon,
    onScreen: z.object({
      heading,
      language: z.string().min(1).max(40),
      fileName: z.string().min(1).max(120),
      initialCode: z.string().max(6_000),
      typedCode: z.string().min(1).max(3_000),
      result: z.string().max(1_000).nullable(),
    }),
  }),
  z.object({
    type: z.literal(SceneType.COMPARISON),
    ...sceneCommon,
    onScreen: z.object({
      heading,
      leftTitle: z.string().min(1).max(60),
      left: z.array(z.string().min(1).max(200)).min(1).max(6),
      rightTitle: z.string().min(1).max(60),
      right: z.array(z.string().min(1).max(200)).min(1).max(6),
    }),
  }),
  z.object({
    type: z.literal(SceneType.CALLOUT),
    ...sceneCommon,
    onScreen: z.object({
      kind: z.enum(['tip', 'warning', 'mistake', 'key_idea']),
      message: z.string().min(1).max(240),
    }),
  }),
  z.object({
    type: z.literal(SceneType.SUMMARY),
    ...sceneCommon,
    onScreen: z.object({ heading, points: z.array(z.string().min(1).max(160)).min(1).max(6) }),
  }),
  z.object({
    type: z.literal(SceneType.EXERCISE_PROMPT),
    ...sceneCommon,
    onScreen: z.object({ heading, task: z.string().min(1).max(400), hint: z.string().max(200).nullable() }),
  }),
  z.object({
    type: z.literal(SceneType.QUIZ_BREAK),
    ...sceneCommon,
    onScreen: z.object({
      question: z.string().min(1).max(240),
      options: z.array(z.string().min(1).max(160)).min(2).max(4),
      correctIndex: z.number().int().min(0).max(3),
      explanation: z.string().min(1).max(400),
    }),
  }),
])

export type Scene = z.infer<typeof sceneSchema>
export type SceneOnScreen = Scene['onScreen']

export const sceneScriptSchema = z
  .object({ scenes: z.array(sceneSchema).min(4).max(40) })
  .superRefine((script, ctx) => {
    if (script.scenes[0]?.type !== SceneType.TITLE_CARD) {
      ctx.addIssue({ code: 'custom', path: ['scenes', 0, 'type'], message: 'The first scene must be TITLE_CARD' })
    }
    if (script.scenes[script.scenes.length - 1]?.type !== SceneType.SUMMARY) {
      ctx.addIssue({ code: 'custom', path: ['scenes', script.scenes.length - 1, 'type'], message: 'The last scene must be SUMMARY' })
    }
    script.scenes.forEach((scene, index) => {
      if (scene.type === SceneType.CODE_WALKTHROUGH) {
        const lineCount = scene.onScreen.code.split('\n').length
        scene.onScreen.steps.forEach((step, stepIndex) => {
          if (step.startLine > step.endLine || step.endLine > lineCount) {
            ctx.addIssue({
              code: 'custom',
              path: ['scenes', index, 'onScreen', 'steps', stepIndex],
              message: `Highlight lines must satisfy startLine <= endLine <= ${lineCount} (the code has ${lineCount} lines)`,
            })
          }
        })
      }
      if (scene.type === SceneType.QUIZ_BREAK && scene.onScreen.correctIndex >= scene.onScreen.options.length) {
        ctx.addIssue({ code: 'custom', path: ['scenes', index, 'onScreen', 'correctIndex'], message: 'correctIndex must point at an option' })
      }
    })
  })

export type SceneScript = z.infer<typeof sceneScriptSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: courseLandingSchema, CourseLanding,
 *   CourseLandingWriterOutput, landing page copy
 *
 * WHAT:  Learner-facing landing copy (docs/11 §1, marketplace-style).
 * WHERE: Course Landing writer output; Course.subtitle/description/
 *        whatYouWillLearn/requirements/targetAudience (title too).
 */
export const courseLandingSchema = z.object({
  title: z.string().trim().min(5).max(60),
  subtitle: z.string().trim().min(10).max(120),
  description: z.string().trim().min(100).max(5_000),
  whatYouWillLearn: z.array(z.string().trim().min(5).max(160)).min(4).max(10),
  requirements: z.array(z.string().trim().min(3).max(160)).min(1).max(8),
  targetAudience: z.array(z.string().trim().min(5).max(160)).min(1).max(6),
})

export type CourseLanding = z.infer<typeof courseLandingSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: courseQualityReportSchema, CourseQualityReport,
 *   QualityCheck, COURSE_QUALITY_MINIMUMS
 *
 * WHAT:  Deterministic readiness checks run when a build finishes
 *        (docs/11 §1 quality bar) — counted from Course State, no model call.
 * WHERE: Course.qualityReport; computed by src/lib/courses/quality.ts; shown
 *        on the course workspace.
 */
export const COURSE_QUALITY_MINIMUMS = { lectures: 5, videoMinutes: 30 } as const

export const qualityCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  passed: z.boolean(),
  detail: z.string(),
})

export const courseQualityReportSchema = z.object({
  computedAt: z.string(),
  lectures: z.number().int(),
  estimatedVideoMinutes: z.number(),
  checks: z.array(qualityCheckSchema),
})

export type QualityCheck = z.infer<typeof qualityCheckSchema>
export type CourseQualityReport = z.infer<typeof courseQualityReportSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: lessonIdSchema, LessonIdValues
 *
 * WHAT:  Addresses one lesson inside a course.
 * WHERE: lessons router; lesson page.
 */
export const lessonIdSchema = courseIdSchema.extend({ lessonId: z.string().min(1) })
export type LessonIdValues = z.infer<typeof lessonIdSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: projectBriefSchema, ProjectBrief, final project,
 *   capstone, project rubric, starter files, ProjectDesignerOutput
 *
 * WHAT:  The course's final capstone project (docs/11 §1): brief, outcome
 *        links, milestones with tasks and deliverables, starter files, a
 *        points rubric, stretch goals, and a reference solution.
 * WHY:   Structured so the learner view can show milestones as a checklist,
 *        the source-code download (step 9b) can ship starter files and the
 *        reference solution, and the rubric total is checkable. Starter files
 *        may be empty for non-programming courses.
 * WHERE: Course.finalProject; projectDesigner agent output; Practice tab;
 *        learner player project view.
 */
const projectFileSchema = z.object({
  path: z.string().trim().min(1).max(160),
  language: z.string().trim().min(1).max(40),
  content: z.string().max(12_000),
})

export const projectBriefSchema = z.object({
  title: z.string().trim().min(3).max(120),
  summary: z.string().trim().min(20).max(2_000),
  objectiveRefs: z.array(objectiveRefSchema).min(1).max(20),
  estimatedHours: z.number().min(0.5).max(40),
  milestones: z
    .array(
      z.object({
        title: z.string().trim().min(3).max(120),
        description: z.string().trim().max(1_000),
        tasks: z.array(z.string().trim().min(3).max(300)).min(1).max(8),
        deliverable: z.string().trim().min(3).max(300),
      })
    )
    .min(2)
    .max(8),
  starterFiles: z.array(projectFileSchema).max(12),
  rubric: z
    .array(
      z.object({
        criterion: z.string().trim().min(2).max(120),
        description: z.string().trim().max(500),
        points: z.number().int().min(1).max(50),
      })
    )
    .min(3)
    .max(10),
  stretchGoals: z.array(z.string().trim().min(3).max(300)).max(6),
  referenceSolution: z.array(projectFileSchema).max(12),
})

export type ProjectBrief = z.infer<typeof projectBriefSchema>

/**
 * SOURCE OF TRUTH KEYWORDS: cheatSheetSchema, CheatSheet,
 *   CheatSheetWriterOutput, quick reference
 *
 * WHAT:  A condensed one-to-two page reference of the whole course: short
 *        sections of key points with optional code snippets.
 * WHERE: Course.cheatSheet; cheatSheetWriter agent; cheat sheet PDF.
 */
export const cheatSheetSchema = z.object({
  title: z.string().trim().min(3).max(120),
  sections: z
    .array(
      z.object({
        heading: z.string().trim().min(2).max(80),
        points: z.array(z.string().trim().min(2).max(220)).min(1).max(8),
        code: z.object({ language: z.string().trim().min(1).max(40), snippet: z.string().min(1).max(800) }).nullable(),
      })
    )
    .min(3)
    .max(12),
})

export type CheatSheet = z.infer<typeof cheatSheetSchema>
