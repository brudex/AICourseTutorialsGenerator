/**
 * SOURCE OF TRUTH KEYWORDS: LEARNER_LEVEL_GUIDES, learnerLevelGuide,
 *   lectureMinutesFor, audienceAgeRange, defaultAudienceProfile,
 *   DEFAULT_LEARNER_LEVEL, audience specialization, teaching guide per level,
 *   toddlers juniors seniors undergraduates graduates masters phd professionals
 *
 * WHAT:  The teaching guide for each learner level: language, methodology,
 *        examples, structure, assessments, academic depth, illustration
 *        style and count, narration delivery, lecture length and suggested teaching
 *        styles. Plus small helpers that resolve a brief's profile.
 * WHY:   One table drives everything that adapts to the audience: agent
 *        prompts (describeBriefForPrompt), lecture length caps (Curriculum
 *        Architect), picture style (Illustrator), voice pace (Narrator) and
 *        the new-course form. Adding or tuning a level is an edit here, not
 *        in each agent. Safe for client and server (no server imports).
 * WHERE: src/lib/agents (course-context, curriculum-architect, narrator,
 *        visual-renderer, brief-writer), AudienceProfileFields, new-course
 *        forms.
 */

import { LEARNER_LEVELS, type AudienceProfile, type LearnerLevel, type LearnerLevelGuide, type LectureMinutes } from '@/lib/types'

export const DEFAULT_LEARNER_LEVEL: LearnerLevel = 'professionals'

/**
 * SOURCE OF TRUTH KEYWORDS: OFFERED_LEARNER_LEVELS, offeredLearnerLevels,
 *   learner level picker, package audience limit, who is it for, levels shown
 * WHAT:  The levels an author can pick in "Who is it for?", in display order.
 * WHY:   A licensed package can offer fewer levels (e.g. only university and
 *        professionals) by narrowing this one list; every level keeps its
 *        guide so courses saved at another level still work.
 * WHERE: AudienceProfileFields (new course and edit course forms).
 */
export const OFFERED_LEARNER_LEVELS: readonly LearnerLevel[] = LEARNER_LEVELS.filter((level) => ["undergraduates","graduates","masters","phd","professionals"].includes(level))

/**
 * SOURCE OF TRUTH KEYWORDS: AUDIENCE_CUSTOMIZE_ENABLED, customize this audience,
 *   age range, prior knowledge, learning goals, package audience panel
 * WHAT:  Whether "Who is it for?" shows the "Customize this audience" panel.
 * WHY:   A licensed package can ship the simpler picker (level only); briefs
 *        then keep the level's usual ages and empty knowledge and goals.
 * WHERE: AudienceProfileFields.
 */
export const AUDIENCE_CUSTOMIZE_ENABLED: boolean = false

/* Offered levels, plus the course's current level if a package left it out. */
export function offeredLearnerLevels(current: LearnerLevel): readonly LearnerLevel[] {
  return OFFERED_LEARNER_LEVELS.includes(current) ? OFFERED_LEARNER_LEVELS : [...OFFERED_LEARNER_LEVELS, current]
}

export const LEARNER_LEVEL_GUIDES: Record<LearnerLevel, LearnerLevelGuide> = {
  toddlers: {
    label: 'Toddlers',
    summary: 'Ages 2 to 5, playful and guided by a grown up',
    ages: { min: 2, max: 5 },
    lectureMinutes: { min: 2, typical: 4, max: 6 },
    language:
      'Very short sentences of three to eight words. Only everyday words a small child hears at home. Repeat key words often. Never use jargon, abstract terms or numbers above ten unless they are the topic.',
    methodology:
      'Play based learning led by a parent or carer: songs, rhymes, call and response, pointing and naming, copying actions, gentle repetition. One tiny idea per lesson. Praise every attempt.',
    examples:
      'Toys, animals, colours, food, family, bath time, the park. Familiar, safe, joyful scenes a child can touch or see at home.',
    structure:
      'Very short lessons, one idea each, with a warm hello, the idea shown three different ways, a playful activity, and a goodbye that repeats the idea. Few modules; each module is a theme (colours, animals).',
    assessments:
      'No tests or scores. Use playful checks read aloud by a grown up: point to the picture, find the matching one, say the word, do the action. Every quiz option is a simple picture word. Exercises are play activities for a grown up and child together. Projects are a small craft or game.',
    depth: 'Foundational awareness only: recognise, name, copy. No theory.',
    illustrationStyle:
      'Bright, friendly picture book illustration for young children: big rounded shapes, cheerful saturated colours, smiling characters and animals, very simple background, one clear subject.',
    illustrations: { min: 2, max: 4 },
    narration: { speedFactor: 0.85, delivery: 'Slow, warm, playful and expressive, like reading a picture book to a small child. Leave little pauses for the child to answer.' },
    teachingStyles: ['Songs, rhymes and play', 'Show and tell with pictures', 'Copy the action, then try it'],
  },
  juniors: {
    label: 'Juniors',
    summary: 'Primary school, ages 6 to 11',
    ages: { min: 6, max: 11 },
    lectureMinutes: { min: 4, typical: 7, max: 10 },
    language:
      'Short clear sentences and familiar words. Introduce at most two new words per lesson, each with a child friendly meaning and an example. Speak directly to the learner ("you").',
    methodology:
      'Story led and hands on: a character or challenge to solve, discovery through simple experiments and games, worked examples step by step, frequent recap, lots of encouragement.',
    examples:
      'School, playground, pets, sport, cartoons, cooking, nature, simple everyday money and time. Concrete things a child can picture.',
    structure:
      'Short lessons with a hook question, two or three small steps, a quick game style check and a recap. Modules are themes that build from easy to a little harder.',
    assessments:
      'Short fun quizzes with simple wording, picture friendly multiple choice and true or false, matching and fill the blank. Exercises are hands on activities and puzzles. Projects are a small make or show and tell. Explanations are encouraging.',
    depth: 'Foundations and concrete understanding. Explain how and why with simple cause and effect, no formal theory.',
    illustrationStyle:
      'Colourful, friendly children’s educational illustration: clear cartoon characters, bold shapes, playful but uncluttered scenes that show the idea plainly.',
    illustrations: { min: 2, max: 4 },
    narration: { speedFactor: 0.92, delivery: 'Friendly, upbeat and encouraging, like a favourite primary school teacher. Clear and a little slower than normal.' },
    teachingStyles: ['Story led with fun challenges', 'Hands on activities and games', 'Visual, with pictures and simple diagrams'],
  },
  seniors: {
    label: 'Seniors',
    summary: 'Secondary and high school, ages 12 to 18',
    ages: { min: 12, max: 18 },
    lectureMinutes: { min: 5, typical: 10, max: 15 },
    language:
      'Clear, direct language that respects teenagers. Introduce subject vocabulary with definitions and use it consistently. Avoid talking down.',
    methodology:
      'Explain, show, practise: worked examples, guided practice, then independent practice. Relate ideas to exams and to real life. Encourage questions and short reflections.',
    examples:
      'Social media, gaming, sport, music, school projects, part time jobs, the environment and the local community. Current, relatable scenarios.',
    structure:
      'Focused lessons with a clear objective, an explanation, a worked example, practice and a summary. Modules follow a logical syllabus order and end with a review.',
    assessments:
      'Exam style quizzes at school level: multiple choice, short answer style scenarios and fill the blank, with clear explanations. Exercises progress from guided to independent. Projects are practical school style projects or investigations.',
    depth: 'Core concepts with reasons and simple models. Introduce formal terms and basic theory where the syllabus needs it.',
    illustrationStyle:
      'Modern, clean educational illustration for teenagers: confident flat style, realistic proportions, relatable everyday settings, clear focal point.',
    illustrations: { min: 1, max: 3 },
    narration: { speedFactor: 1, delivery: 'Clear, energetic and relatable, like an engaging secondary school teacher.' },
    teachingStyles: ['Explain, show, then practise', 'Exam focused with worked examples', 'Real life projects and investigations'],
  },
  undergraduates: {
    label: 'Undergraduates',
    summary: 'University students building core knowledge',
    ages: { min: 18, max: 24 },
    lectureMinutes: { min: 6, typical: 12, max: 18 },
    language:
      'Academic but accessible. Define discipline terms precisely on first use. Use correct notation and terminology.',
    methodology:
      'Lecture plus active learning: concept, worked example, application, then problem solving. Connect theory to practice and to prior modules. Encourage critical questions.',
    examples:
      'Textbook style cases, lab and industry scenarios, data sets, and classic problems of the discipline.',
    structure:
      'Lessons follow a university module: learning objectives, theory, worked examples, applications and a summary. Modules match a semester style syllabus building to integration.',
    assessments:
      'University level quizzes testing understanding and application, problem sets with full worked solutions, scenario questions, and projects such as a lab report, case study or applied build.',
    depth: 'Solid theoretical foundations with application. Introduce key models, proofs or frameworks and their limits.',
    illustrationStyle:
      'Clean academic illustration: accurate, well labelled concepts drawn without text, neutral professional palette, precise and uncluttered.',
    illustrations: { min: 1, max: 2 },
    narration: { speedFactor: 1, delivery: 'Clear and engaging university lecturer: confident, structured and friendly.' },
    teachingStyles: ['Lecture with worked examples', 'Problem solving and applications', 'Case studies and projects'],
  },
  graduates: {
    label: 'Graduates',
    summary: 'Graduates deepening or applying their degree',
    ages: { min: 21, max: 30 },
    lectureMinutes: { min: 8, typical: 14, max: 20 },
    language:
      'Professional academic language. Assume degree level vocabulary; define only specialist terms.',
    methodology:
      'Applied and analytical: frameworks applied to realistic problems, comparison of approaches, trade offs and justification. Learners reason through cases before seeing the answer.',
    examples:
      'Realistic workplace and research cases, industry data, standards and published examples from the field.',
    structure:
      'Lessons move from framework to application to evaluation. Modules build toward an integrated applied capability.',
    assessments:
      'Scenario based and analytical quizzes, applied case exercises, and projects that solve a realistic problem with a justified recommendation.',
    depth: 'Applied mastery: use, compare and evaluate methods with their assumptions and limitations.',
    illustrationStyle:
      'Professional editorial illustration: realistic settings, calm sophisticated palette, clear concept focus.',
    illustrations: { min: 1, max: 2 },
    narration: { speedFactor: 1, delivery: 'Professional, confident and concise, like an experienced practitioner teaching peers.' },
    teachingStyles: ['Applied case studies', 'Frameworks with real examples', 'Practical projects with feedback'],
  },
  masters: {
    label: "Master's",
    summary: 'Postgraduate study with advanced specialisation',
    ages: { min: 22, max: 40 },
    lectureMinutes: { min: 8, typical: 15, max: 20 },
    language:
      'Advanced academic and professional language, precise and dense but clear. Use the field’s specialist terminology freely.',
    methodology:
      'Seminar style: critical analysis of theories and evidence, debate of competing views, synthesis across sources, and application to complex cases.',
    examples:
      'Current research findings, complex real world cases, policy and industry debates, and seminal papers of the field.',
    structure:
      'Lessons pose a critical question, review the theory and evidence, analyse a complex case and draw implications. Modules build toward a substantial independent project.',
    assessments:
      'Critical and evaluative questions, complex case analyses, literature based exercises and a capstone such as an applied research project or professional report.',
    depth: 'Advanced theory and critical evaluation: strengths, weaknesses, evidence and open questions.',
    illustrationStyle:
      'Sophisticated conceptual illustration: refined, minimal, abstract where helpful, scholarly tone.',
    illustrations: { min: 1, max: 2 },
    narration: { speedFactor: 1, delivery: 'Measured, thoughtful and authoritative, like a postgraduate seminar leader.' },
    teachingStyles: ['Seminar style critical analysis', 'Research informed case studies', 'Independent applied project'],
  },
  phd: {
    label: 'PhD',
    summary: 'Doctoral researchers at the frontier of the field',
    ages: { min: 24, max: 45 },
    lectureMinutes: { min: 10, typical: 16, max: 20 },
    language:
      'Scholarly, rigorous and precise. Use formal terminology and notation; cite the canonical works, methods and debates by name where relevant.',
    methodology:
      'Research oriented: deconstruct theories and methods, examine assumptions, compare methodologies, identify gaps in the literature and frame original research questions.',
    examples:
      'Primary research, landmark and recent papers, methodological case studies, unresolved problems and contested findings.',
    structure:
      'Lessons examine a theory or method in depth, its evidence, critiques and open problems, then a research implication. Modules build toward proposing original research.',
    assessments:
      'Deep analytical and methodological questions, critique of studies, research design exercises, and a capstone such as a research proposal, literature review or original study design.',
    depth: 'Frontier depth: advanced theory, methodology, critique and original research.',
    illustrationStyle:
      'Precise scientific style illustration: clean, accurate, minimal, like a figure in a research journal, no decoration.',
    illustrations: { min: 1, max: 1 },
    narration: { speedFactor: 1, delivery: 'Calm, precise and scholarly, like a senior researcher presenting to colleagues.' },
    teachingStyles: ['Research seminar and critique', 'Methodology deep dives', 'Proposal and original research'],
  },
  professionals: {
    label: 'Professionals',
    summary: 'Working adults building job ready skills',
    ages: null,
    lectureMinutes: { min: 5, typical: 10, max: 15 },
    language:
      'Plain, professional language. Be direct and practical; define jargon once and use it consistently.',
    methodology:
      'Practical and outcome driven: show the job task, demonstrate it step by step, then let learners apply it. Respect experience and time.',
    examples:
      'Real workplace tasks, tools, clients, reports and decisions from the learners’ industry.',
    structure:
      'Short, focused lessons on one job task each, with a demo, practice and a takeaway. Modules map to workplace competencies.',
    assessments:
      'Scenario based questions from real work situations, practical exercises with the actual tools, and a portfolio style project that proves the skill.',
    depth: 'Applied competence and best practice, with enough theory to make sound decisions.',
    illustrationStyle:
      'Modern professional editorial illustration: realistic workplace settings, calm professional colours with deep blue accents.',
    illustrations: { min: 1, max: 3 },
    narration: { speedFactor: 1.05, delivery: 'Warm, clear and efficient, like an expert colleague coaching at work.' },
    teachingStyles: ['Practical, with real-world examples', 'Project-based, build as you learn', 'Concise and fast-paced'],
  },
}

export function learnerLevelGuide(level: LearnerLevel): LearnerLevelGuide {
  return LEARNER_LEVEL_GUIDES[level]
}

/* Lecture length for the brief's level; never above the platform cap. */
export function lectureMinutesFor(profile: AudienceProfile, cap: number): LectureMinutes {
  const { min, typical, max } = LEARNER_LEVEL_GUIDES[profile.level].lectureMinutes
  return { min: Math.min(min, cap), typical: Math.min(typical, cap), max: Math.min(max, cap) }
}

/* The author's age range, else the level's usual one; null when ages do not apply. */
export function audienceAgeRange(profile: AudienceProfile): { min: number; max: number } | null {
  const fallback = LEARNER_LEVEL_GUIDES[profile.level].ages
  const min = profile.ageMin ?? fallback?.min ?? null
  const max = profile.ageMax ?? fallback?.max ?? null
  if (min === null && max === null) return null
  return { min: min ?? max ?? 0, max: max ?? min ?? 0 }
}

export function defaultAudienceProfile(level: LearnerLevel = DEFAULT_LEARNER_LEVEL): AudienceProfile {
  return { level, ageMin: null, ageMax: null, priorKnowledge: '', learningGoals: '' }
}
