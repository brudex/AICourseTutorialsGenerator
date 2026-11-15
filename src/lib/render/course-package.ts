import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: buildCoursePackage, course export ZIP, Udemy
 *   upload package, Teachable export, course.json, course-outline.md
 *
 * WHAT:  Packs a whole course into one ZIP an instructor can upload to
 *        Udemy, Teachable or Thinkific: per lecture MP4 + WebVTT captions +
 *        notes + quiz, section quizzes, the final assessment and project
 *        brief, every download (learner files in resources/, instructor
 *        files in instructor/), the landing copy and curriculum
 *        (course-outline.md), a README with upload steps, and course.json.
 * WHY:   Folders are numbered in course order, so they read like the
 *        curriculum on any platform. Videos are stored without recompression
 *        (MP4 is already compressed); text is deflated. Lectures without a
 *        rendered video are still listed, marked as missing, so a partial
 *        course can be exported and the gaps are visible. Pure apart from
 *        reading stored files through `read`.
 * WHERE: courseExporter agent (src/lib/agents/course-exporter.ts).
 */

import JSZip from 'jszip'

import { COURSE_PACKAGE_FORMAT, type CoursePackageInput, type CoursePackageManifest, type CoursePackageSection } from '@/lib/types'
import { slugify } from '@/lib/utils'
import { courseOutlineMarkdown, lessonNotesMarkdown, projectMarkdown, questionsMarkdown } from './markdown'

const pad = (n: number) => String(n).padStart(2, '0')

export async function buildCoursePackage(
  input: CoursePackageInput,
  read: (storageKey: string) => Promise<Uint8Array>
): Promise<{ zip: Uint8Array; manifest: CoursePackageManifest; missingVideos: number }> {
  const zip = new JSZip()
  const rootName = slugify(input.course.title, 'course')
  const root = zip.folder(rootName)
  if (!root) throw new Error('Could not create the package folder.')
  const text = (path: string, content: string) => root.file(path, content)
  const media = async (path: string, key: string) => root.file(path, await read(key), { compression: 'STORE' })

  const quizByLesson = new Map(input.source.lessons.map((l) => [l.lessonId, l.quiz]))
  const sections: CoursePackageSection[] = []
  let missingVideos = 0

  for (const [s, mod] of input.modules.entries()) {
    const lectures = input.lectures.filter((l) => l.moduleId === mod.id)
    if (lectures.length === 0) continue
    const sectionDir = `sections/${pad(sections.length + 1)}-${slugify(mod.title, 'section')}`
    const section: CoursePackageSection = { title: mod.title, lectures: [], quiz: null }

    for (const [i, lecture] of lectures.entries()) {
      const dir = `${sectionDir}/${pad(i + 1)}-${slugify(lecture.title, 'lecture')}`
      const video = lecture.video ? `${dir}/lecture.mp4` : null
      const captions = lecture.captionsKey ? `${dir}/captions.vtt` : null
      const notes = lecture.content ? `${dir}/notes.md` : null
      const quizItems = quizByLesson.get(lecture.lessonId) ?? []
      const quiz = quizItems.length ? `${dir}/quiz.md` : null
      if (lecture.video && video) await media(video, lecture.video.storageKey)
      else missingVideos += 1
      if (lecture.captionsKey && captions) await media(captions, lecture.captionsKey)
      if (lecture.content && notes) text(notes, lessonNotesMarkdown(lecture.title, lecture.content))
      if (quiz) text(quiz, questionsMarkdown(`Quiz: ${lecture.title}`, quizItems))
      section.lectures.push({
        title: lecture.title,
        kind: lecture.kind,
        estimatedMinutes: lecture.estimatedMinutes,
        videoDurationSeconds: lecture.video?.durationMs ? Math.round(lecture.video.durationMs / 1000) : null,
        video,
        captions,
        notes,
        quiz,
      })
    }

    const sectionQuiz = input.source.sectionQuizzes.find((q) => q.moduleId === mod.id)
    if (sectionQuiz) {
      section.quiz = `${sectionDir}/section-quiz.md`
      text(section.quiz, questionsMarkdown(`Section ${s + 1} quiz: ${mod.title}`, sectionQuiz.items))
    }
    sections.push(section)
  }

  const finalAssessment = input.source.finalAssessment.length ? 'final-assessment.md' : null
  if (finalAssessment) text(finalAssessment, questionsMarkdown('Final assessment', input.source.finalAssessment))
  const project = input.source.project ? 'project/brief.md' : null
  if (project && input.source.project) text(project, projectMarkdown(input.source.project))

  const resources: CoursePackageManifest['resources'] = []
  for (const material of input.materials) {
    const file = `${material.audience === 'INSTRUCTOR' ? 'instructor' : 'resources'}/${material.fileName}`
    await media(file, material.storageKey)
    resources.push({ title: material.title, file, audience: material.audience })
  }

  const manifest: CoursePackageManifest = {
    format: COURSE_PACKAGE_FORMAT.name,
    version: COURSE_PACKAGE_FORMAT.version,
    exportedAt: new Date().toISOString(),
    course: input.course,
    sections,
    resources,
    finalAssessment,
    project,
  }
  text('course.json', `${JSON.stringify(manifest, null, 2)}\n`)
  text('course-outline.md', courseOutlineMarkdown(manifest))
  text(
    'README.md',
    [
      `# ${input.course.title}: course package`,
      '',
      'Everything needed to publish this course on Udemy, Teachable, Thinkific or any LMS.',
      '',
      '## What is inside',
      '',
      '- `course-outline.md`: title, subtitle, description, what you will learn, requirements, audience and the curriculum, ready to paste into the course landing page.',
      '- `sections/NN-section/NN-lecture/`: `lecture.mp4` (1080p video), `captions.vtt` (subtitles), `notes.md` (lecture notes) and `quiz.md` (questions with answers).',
      '- `sections/NN-section/section-quiz.md`: the end of section quiz.',
      ...(finalAssessment ? ['- `final-assessment.md`: the final assessment with answers.'] : []),
      ...(project ? ['- `project/brief.md`: the final project brief and rubric.'] : []),
      '- `resources/`: downloads to attach for learners (workbook, cheat sheet, glossary, source code).',
      '- `instructor/`: files for you only, such as the answer key. Do not attach these for learners.',
      '- `course.json`: the same structure in machine readable form.',
      '',
      '## Publishing on Udemy',
      '',
      '1. Create the course, then paste the landing page fields from `course-outline.md`.',
      '2. In Curriculum, add one section per `sections/` folder and one lecture per lecture folder, in order.',
      '3. Upload each `lecture.mp4` as the lecture video, then add `captions.vtt` under Captions.',
      '4. Attach the files in `resources/` as downloadable resources (the workbook and source code to the first lecture, for example).',
      '5. Add the quizzes from the `quiz.md` files; correct options are ticked.',
      '',
      ...(missingVideos ? [`Note: ${missingVideos} lecture${missingVideos === 1 ? ' has' : 's have'} no rendered video yet. Render videos in the studio and export again.`, ''] : []),
    ].join('\n')
  )

  return { zip: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), manifest, missingVideos }
}
