import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS:⁠​‌‌​​‌‌​​‌​‌‌‌​​‌‌​‌​​​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​‌‌‌‌​​​‌​​‌​‌​​​‌​​‌‌‌⁠ buildSourceArchive, source code ZIP, JSZip,
 *   code demos download, exercise files, project starter files
 *
 * WHAT:  Packs the course's code into one ZIP: every lecture code demo,
 *        each exercise's starter / solution / tests with a README of its
 *        instructions, the final project's starter files, and a top-level
 *        README describing the layout.
 * WHY:   Learners expect to download the code they see in the videos
 *        (docs/11 §1). Folders are numbered in course order so the archive
 *        reads like the curriculum. Exercise solutions are included because
 *        learners can already reveal them in the player; the project's
 *        reference solution is not (it stays in the instructor answer key).
 *        Returns null when the course has no code at all, so non-programming
 *        courses get no empty ZIP.
 * WHERE: materialsBuilder agent (src/lib/agents/materials-builder.ts).
 */

import JSZip from 'jszip'

import { codeFileExtension } from '@/lib/config/course-materials'
import type { MaterialSource } from '@/lib/types'
import { slugify } from '@/lib/utils'

const pad = (n: number) => String(n).padStart(2, '0')

export async function buildSourceArchive(source: MaterialSource): Promise<Uint8Array | null> {
  const zip = new JSZip()
  const root = zip.folder(slugify(source.course.title, 'course'))
  if (!root) return null
  let files = 0

  for (const [index, lesson] of source.lessons.entries()) {
    const folder = `lectures/${pad(index + 1)}-${slugify(lesson.title, 'lecture')}`
    lesson.content.sections
      .flatMap((s) => (s.type === 'code_demo' ? [s] : []))
      .forEach((demo, i) => {
        root.file(`${folder}/demo-${i + 1}.${codeFileExtension(demo.language)}`, demo.code)
        files += 1
      })
    lesson.exercises.forEach((exercise, i) => {
      const { content } = exercise
      const ext = codeFileExtension(content.language)
      const dir = `${folder}/exercise-${i + 1}-${slugify(exercise.title, 'exercise')}`
      root.file(
        `${dir}/README.md`,
        [`# ${exercise.title}`, '', content.instructions, '', ...(content.expectedOutput ? ['## Expected result', '', content.expectedOutput, ''] : []),
          ...(content.hints.length ? ['## Hints', '', ...content.hints.map((h) => `- ${h}`), ''] : [])].join('\n')
      )
      if (content.starterCode) root.file(`${dir}/starter.${ext}`, content.starterCode)
      root.file(`${dir}/solution.${ext}`, content.solution)
      if (content.tests) root.file(`${dir}/tests.${ext}`, content.tests)
      files += 1
    })
  }

  for (const file of source.project?.starterFiles ?? []) {
    root.file(`project/starter/${file.path.replace(/^\/+/, '').replace(/\.\.\//g, '')}`, file.content)
    files += 1
  }
  if (files === 0) return null

  root.file(
    'README.md',
    [
      `# ${source.course.title}`,
      '',
      ...(source.course.subtitle ? [source.course.subtitle, ''] : []),
      'Source code for the course, in lecture order.',
      '',
      '- `lectures/NN-name/demo-N.*`: the code shown in each lecture video',
      '- `lectures/NN-name/exercise-N-name/`: instructions, starter file, solution and tests for each exercise',
      ...(source.project?.starterFiles.length ? [`- \`project/starter/\`: the starter files for the final project, ${source.project.title}`] : []),
      '',
      'Try each exercise from the starter file before opening the solution.',
    ].join('\n')
  )
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}
