import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: lessonNotesMarkdown, questionsMarkdown,
 *   projectMarkdown, courseOutlineMarkdown, Markdown export, course package
 *   text files
 *
 * WHAT:  Plain Markdown versions of course content: lecture notes, quizzes
 *        with answers, the project brief, and the course outline (landing
 *        copy plus curriculum).
 * WHY:   Every course platform accepts pasted text or Markdown, and it reads
 *        well in any editor, so exports use it for everything that is not a
 *        video, caption or PDF. Answers are included because the export is an
 *        instructor package, not a learner download.
 * WHERE: src/lib/render/course-package.ts.
 */

import type { AssessmentItemContent, CoursePackageManifest, LessonContent, ProjectBrief } from '@/lib/types'

const bullets = (items: readonly string[]) => items.map((i) => `- ${i}`).join('\n')
const fence = (code: string, language: string) => `\`\`\`${language}\n${code.replace(/\n$/, '')}\n\`\`\``

const TEXT_SECTION_LABELS: Partial<Record<LessonContent['sections'][number]['type'], string>> = {
  analogy: 'Analogy',
  example: 'Example',
  summary: 'Summary',
}

export function lessonNotesMarkdown(title: string, content: LessonContent): string {
  const parts = [`# ${title}`, '', '## In this lecture you will', '', bullets(content.objectives)]
  for (const section of content.sections) {
    const heading = 'heading' in section && section.heading ? section.heading : null
    switch (section.type) {
      case 'hook':
      case 'explanation':
      case 'analogy':
      case 'example':
      case 'summary': {
        const label = heading ?? TEXT_SECTION_LABELS[section.type]
        parts.push('', ...(label ? [`## ${label}`, ''] : []), section.body)
        break
      }
      case 'code_demo':
        parts.push('', `## ${heading ?? 'Code demo'}`, '', fence(section.code, section.language), '', section.explanation)
        break
      case 'common_mistakes':
        parts.push('', `## ${heading ?? 'Common mistakes'}`, '', section.items.map((m) => `- **${m.mistake}**: ${m.fix}`).join('\n'))
        break
      case 'further_learning':
        parts.push('', `## ${heading ?? 'Further learning'}`, '', bullets(section.items))
        break
      case 'illustration_request':
        break
    }
  }
  return `${parts.filter((p, i, all) => !(p === '' && all[i - 1] === '')).join('\n')}\n`
}

function optionLines(options: ReadonlyArray<{ id: string; text: string }>, correct: ReadonlySet<string>): string {
  return options.map((o) => `- [${correct.has(o.id) ? 'x' : ' '}] ${o.text}`).join('\n')
}

function questionMarkdown(item: AssessmentItemContent, number: number): string {
  const head = (text: string) => `### ${number}. ${text}`
  let body: string
  switch (item.type) {
    case 'MULTIPLE_CHOICE':
      body = `${head(item.question)}\n\n${optionLines(item.options, new Set([item.correctOptionId]))}`
      break
    case 'SCENARIO':
      body = `${head(item.question)}\n\n${item.scenario}\n\n${optionLines(item.options, new Set([item.correctOptionId]))}`
      break
    case 'MULTIPLE_RESPONSE':
      body = `${head(item.question)} (select all that apply)\n\n${optionLines(item.options, new Set(item.correctOptionIds))}`
      break
    case 'TRUE_FALSE':
      body = `${head(item.statement)}\n\n**Answer:** ${item.answer ? 'True' : 'False'}`
      break
    case 'SHORT_ANSWER':
      body = `${head(item.question)}\n\n**Sample answer:** ${item.sampleAnswer}\n\n**Look for:**\n${bullets(item.rubric)}`
      break
    case 'FILL_BLANK':
      body = `${head(item.text)}\n\n**Answers:** ${item.answers.join(', ')}`
      break
    case 'MATCHING':
      body = `${head(item.prompt)}\n\n${item.pairs.map((p) => `- ${p.left} → ${p.right}`).join('\n')}`
      break
  }
  return `${body}\n\n*Why:* ${item.explanation}`
}

export function questionsMarkdown(title: string, items: readonly AssessmentItemContent[]): string {
  return `# ${title}\n\nCorrect options are ticked.\n\n${items.map((item, i) => questionMarkdown(item, i + 1)).join('\n\n')}\n`
}

export function projectMarkdown(project: ProjectBrief): string {
  return [
    `# Final project: ${project.title}`,
    '',
    `About ${project.estimatedHours} hours.`,
    '',
    project.summary,
    '',
    ...project.milestones.flatMap((m, i) => [
      `## Milestone ${i + 1}: ${m.title}`,
      '',
      m.description,
      '',
      bullets(m.tasks),
      '',
      `**Deliverable:** ${m.deliverable}`,
      '',
    ]),
    '## Rubric',
    '',
    '| Criterion | What good looks like | Points |',
    '| --- | --- | --- |',
    ...project.rubric.map((r) => `| ${r.criterion} | ${r.description.replace(/\|/g, '\\|')} | ${r.points} |`),
    '',
    ...(project.stretchGoals.length ? ['## Stretch goals', '', bullets(project.stretchGoals), ''] : []),
    ...(project.starterFiles.length ? ['Starter files are in `resources/source-code.zip` under `project/starter/`.', ''] : []),
  ].join('\n')
}

/** Landing copy and curriculum, laid out to paste into a course platform. */
export function courseOutlineMarkdown(manifest: CoursePackageManifest): string {
  const { course } = manifest
  const minutes = (seconds: number | null, estimate: number) =>
    seconds !== null ? `${Math.max(1, Math.round(seconds / 60))} min` : `about ${estimate} min`
  return [
    `# ${course.title}`,
    '',
    ...(course.subtitle ? [`*${course.subtitle}*`, ''] : []),
    `Language: ${course.language} · Level: ${course.difficulty.toLowerCase()}`,
    '',
    ...(course.description ? ['## Description', '', course.description, ''] : []),
    ...(course.whatYouWillLearn.length ? ["## What you'll learn", '', bullets(course.whatYouWillLearn), ''] : []),
    ...(course.requirements.length ? ['## Requirements', '', bullets(course.requirements), ''] : []),
    ...(course.targetAudience.length ? ['## Who this course is for', '', bullets(course.targetAudience), ''] : []),
    '## Curriculum',
    '',
    ...manifest.sections.flatMap((section, s) => [
      `### Section ${s + 1}: ${section.title}`,
      '',
      ...section.lectures.map(
        (l, i) => `${i + 1}. ${l.title} (${minutes(l.videoDurationSeconds, l.estimatedMinutes)})${l.video ? '' : ' · video not rendered yet'}`
      ),
      ...(section.quiz ? ['', 'Section quiz included.'] : []),
      '',
    ]),
  ].join('\n')
}
