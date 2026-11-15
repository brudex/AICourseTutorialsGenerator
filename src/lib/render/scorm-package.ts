import 'server-only'

/**
 * SOURCE OF TRUTH KEYWORDS: buildScormPackage, SCORM 1.2 package,
 *   imsmanifest.xml, single SCO, LMS import ZIP, ScormCourseData
 *
 * WHAT:  Packs the course as a SCORM 1.2 content package: imsmanifest.xml at
 *        the ZIP root, the player (index.html), course-data.js, every lecture
 *        video and caption file under media/, and learner downloads under
 *        resources/. Instructor files (answer key, project reference
 *        solution) are never included because learners receive this package.
 * WHY:   SCORM 1.2 is the format every LMS imports. One SCO with a mastery
 *        score keeps tracking simple and portable; the manifest lists every
 *        file so strict LMSs accept it. Videos are stored without
 *        recompression. The XSD files are not bundled; LMSs validate against
 *        their own copies.
 * WHERE: scormExporter agent (src/lib/agents/scorm-exporter.ts).
 */

import JSZip from 'jszip'

import { SCORM_MASTERY_SCORE, type CoursePackageInput, type ScormCourseData, type ScormSection } from '@/lib/types'
import { slugify } from '@/lib/utils'
import { escapeHtml } from './html'
import { lessonBodyHtml, projectBriefHtml } from './documents'
import { scormPlayerHtml } from './scorm-player'

const pad = (n: number) => String(n).padStart(2, '0')

function manifestXml(identifier: string, title: string, files: readonly string[]): string {
  const t = escapeHtml(title)
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${identifier}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.imsglobal.org/xsd/imsmd_rootv1p2p1 imsmd_rootv1p2p1.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata>
    <schema>ADL SCORM</schema>
    <schemaversion>1.2</schemaversion>
  </metadata>
  <organizations default="org-1">
    <organization identifier="org-1">
      <title>${t}</title>
      <item identifier="item-1" identifierref="sco-1" isvisible="true">
        <title>${t}</title>
        <adlcp:masteryscore>${SCORM_MASTERY_SCORE}</adlcp:masteryscore>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="sco-1" type="webcontent" adlcp:scormtype="sco" href="index.html">
${files.map((f) => `      <file href="${escapeHtml(f)}"/>`).join('\n')}
    </resource>
  </resources>
</manifest>
`
}

export async function buildScormPackage(
  input: CoursePackageInput,
  read: (storageKey: string) => Promise<Uint8Array>
): Promise<{ zip: Uint8Array; lectures: number; missingVideos: number; resources: number }> {
  const zip = new JSZip()
  const files: string[] = []
  const add = (path: string, body: string | Uint8Array, store = false) => {
    zip.file(path, body, store ? { compression: 'STORE' } : {})
    files.push(path)
  }

  const quizByLesson = new Map(input.source.lessons.map((l) => [l.lessonId, l.quiz]))
  const sections: ScormSection[] = []
  let missingVideos = 0
  let lectures = 0

  for (const mod of input.modules) {
    const rows = input.lectures.filter((l) => l.moduleId === mod.id && l.content !== null)
    if (rows.length === 0) continue
    const section: ScormSection = {
      title: mod.title,
      lectures: [],
      quiz: input.source.sectionQuizzes.find((q) => q.moduleId === mod.id)?.items ?? [],
    }
    for (const lecture of rows) {
      lectures += 1
      const base = `media/${pad(sections.length + 1)}-${pad(section.lectures.length + 1)}-${slugify(lecture.title, 'lecture')}`
      const video = lecture.video ? `${base}.mp4` : null
      const captions = lecture.captionsKey ? `${base}.vtt` : null
      if (lecture.video && video) add(video, await read(lecture.video.storageKey), true)
      else missingVideos += 1
      if (lecture.captionsKey && captions) add(captions, await read(lecture.captionsKey))
      section.lectures.push({
        title: lecture.title,
        minutes: lecture.video?.durationMs ? Math.max(1, Math.round(lecture.video.durationMs / 60_000)) : lecture.estimatedMinutes,
        video,
        captions,
        notesHtml: lecture.content ? await lessonBodyHtml(lecture.content, lecture.figures) : '',
        quiz: quizByLesson.get(lecture.lessonId) ?? [],
      })
    }
    sections.push(section)
  }

  /* Learners receive this package: learner audience files only. */
  const resources: ScormCourseData['resources'] = []
  for (const material of input.materials.filter((m) => m.audience === 'LEARNER')) {
    const file = `resources/${material.fileName}`
    add(file, await read(material.storageKey), true)
    resources.push({ title: material.title, file })
  }

  const data: ScormCourseData = {
    title: input.course.title,
    subtitle: input.course.subtitle,
    language: input.course.language,
    masteryScore: SCORM_MASTERY_SCORE,
    sections,
    finalAssessment: input.source.finalAssessment,
    projectHtml: input.source.project ? projectBriefHtml(input.source.project) : null,
    resources,
  }
  add('course-data.js', `window.COURSE_DATA = ${JSON.stringify(data)};\n`)
  add('index.html', scormPlayerHtml(input.course.title))
  zip.file('imsmanifest.xml', manifestXml(`course-${slugify(input.course.title, 'course')}`, input.course.title, files))

  return {
    zip: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }),
    lectures,
    missingVideos,
    resources: resources.length,
  }
}
