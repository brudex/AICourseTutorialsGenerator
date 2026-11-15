/**
 * SOURCE OF TRUTH KEYWORDS: PUBLISHING_PLATFORMS, PublishingPlatformDefinition,
 *   GOOGLE_OAUTH_SCOPES, PUBLISHING_EXPORT_GUIDES, ExportGuide,
 *   PUBLISHING_CALLBACK_PATH, publishing catalogue
 *
 * WHAT:  Client-safe metadata for publishing: every one-click platform (label,
 *        how it connects, the Google scopes it needs) and the guided imports
 *        for platforms whose APIs cannot receive course content.
 * WHY:   The Connections page, the Publish dialog and the OAuth flow all read
 *        this one table, so adding a platform is a new entry here plus its
 *        publisher. Moodle, Thinkific and Teachable are guides on purpose:
 *        standard Moodle cannot add activities from outside without a plugin,
 *        and Udemy's, Thinkific's and Teachable's public APIs do not accept
 *        course content, so a "connect" button for them would promise
 *        something they cannot do.
 * WHERE: src/lib/publishing/*, src/trpc/routers/publishing.ts, the
 *        Connections settings page and the course Publish dialog.
 */

import { PublishingPlatform, type MaterialKind } from '@/generated/prisma'

export interface PublishingPlatformDefinition {
  label: string
  description: string
  /**
   * How a workspace connects: Google sign-in, Vimeo sign-in, or a site
   * address first (Canvas school, WordPress site) and then sign-in.
   */
  connect: 'google' | 'vimeo' | 'canvas' | 'wordpress' | 'school'
  /** Google scopes requested on connect (Google platforms only). */
  scopes: readonly string[]
  /** What the publish creates there, shown in the Publish dialog. */
  creates: string
  /** The platform's brand mark (public/brand/platforms, from Simple Icons, CC0). */
  logo: string
}

const GOOGLE_IDENTITY_SCOPES = ['openid', 'email', 'profile'] as const

export const PUBLISHING_PLATFORMS: Record<PublishingPlatform, PublishingPlatformDefinition> = {
  YOUTUBE: {
    label: 'YouTube',
    description: 'Upload every lecture video to your channel as a course playlist, with captions.',
    connect: 'google',
    scopes: [
      ...GOOGLE_IDENTITY_SCOPES,
      'https://www.googleapis.com/auth/youtube.upload',
      /* Playlists and captions. */
      'https://www.googleapis.com/auth/youtube.force-ssl',
    ],
    creates: 'A playlist for the course and one video per lecture, with titles, descriptions and captions.',
    logo: '/brand/platforms/youtube.svg',
  },
  GOOGLE_CLASSROOM: {
    label: 'Google Classroom',
    description: 'Post the course as a class: one topic per section, one material per lecture.',
    connect: 'google',
    scopes: [
      ...GOOGLE_IDENTITY_SCOPES,
      'https://www.googleapis.com/auth/classroom.courses',
      'https://www.googleapis.com/auth/classroom.topics',
      'https://www.googleapis.com/auth/classroom.courseworkmaterials',
    ],
    creates:
      'A class with a topic per section and a material per lecture. Lectures already on YouTube are attached as videos.',
    logo: '/brand/platforms/google-classroom.svg',
  },
  CANVAS: {
    label: 'Canvas',
    description: 'Fill a Canvas course with modules, lecture pages, videos and quizzes.',
    connect: 'canvas',
    scopes: [],
    creates: 'A module per section with lecture pages (video and notes), learner downloads and section quizzes.',
    logo: '/brand/platforms/canvas.svg',
  },
  VIMEO: {
    label: 'Vimeo',
    description: 'Upload every lecture to your Vimeo account, grouped in a showcase for the course.',
    connect: 'vimeo',
    scopes: ['public', 'private', 'create', 'edit', 'upload'],
    creates: 'A showcase for the course and one video per lecture, with captions.',
    logo: '/brand/platforms/vimeo.svg',
  },
  GOOGLE_DRIVE: {
    label: 'Google Drive',
    description: 'Save the whole course to a Drive folder: videos, notes, downloads and packages.',
    connect: 'google',
    scopes: [...GOOGLE_IDENTITY_SCOPES, 'https://www.googleapis.com/auth/drive.file'],
    creates: 'A folder with a subfolder per section holding each lecture’s video, captions and notes, plus every download.',
    logo: '/brand/platforms/google-drive.svg',
  },
  LEARNDASH: {
    label: 'LearnDash',
    description: 'Create the course in your WordPress site with LearnDash: lessons, topics and videos.',
    connect: 'wordpress',
    scopes: [],
    creates: 'A LearnDash course with a lesson per section and a topic per lecture (video and notes).',
    logo: '/brand/platforms/wordpress.svg',
  },
  SCHOOL: {
    label: 'Your online school',
    description: 'Send courses made here to your school on your hosted studio, where students sign up and learn.',
    connect: 'school',
    scopes: [],
    creates: 'The whole course in your online school: lectures, videos, notes, quizzes and downloads. Publishing again updates it and keeps students’ progress.',
    logo: '/brand/logo.png',
  },
}

/**
 * SOURCE OF TRUTH KEYWORDS: OFFERED_PUBLISHING_PLATFORMS, isOfferedPublishingPlatform,
 *   PUBLISHING_EXPORT_GUIDES_ENABLED, connections shown, package platform limit
 * WHAT:  Which one-click platforms this install offers, in display order, and
 *        whether the "Import by hand" guides are shown.
 * WHY:   A licensed package can offer fewer platforms (e.g. only YouTube and
 *        Google Drive) by narrowing this one list; the Connections page shows
 *        only these and the publishing router refuses to connect any other.
 * WHERE: Connections settings page, publishing router (connect procedures).
 */
export const OFFERED_PUBLISHING_PLATFORMS: readonly PublishingPlatform[] = Object.values(PublishingPlatform).filter((platform) => ["YOUTUBE","GOOGLE_DRIVE"].includes(platform))

export const PUBLISHING_EXPORT_GUIDES_ENABLED: boolean = false

export function isOfferedPublishingPlatform(platform: PublishingPlatform): boolean {
  return OFFERED_PUBLISHING_PLATFORMS.includes(platform)
}

/* Google and Canvas send the user back here after they approve a connection.
 * Register this path (on the app's address) in each OAuth app. */
export const PUBLISHING_CALLBACK_PATH = '/api/publishing/callback'

export interface ExportGuide {
  id: 'udemy' | 'moodle' | 'thinkific' | 'teachable'
  label: string
  /** Brand mark, when one is available; otherwise the UI shows a neutral icon. */
  logo: string | null
  /** Why it is a guided import rather than a connection. */
  reason: string
  /** The download to upload there. */
  packageKind: Extract<MaterialKind, 'SCORM_PACKAGE' | 'COURSE_PACKAGE'>
  steps: readonly string[]
}

export const PUBLISHING_EXPORT_GUIDES: readonly ExportGuide[] = [
  {
    id: 'udemy',
    label: 'Udemy',
    logo: '/brand/platforms/udemy.svg',
    reason: 'Udemy only accepts lectures through its own course editor, so the course is uploaded there by hand.',
    packageKind: 'COURSE_PACKAGE',
    steps: [
      'On the course, open Generate and choose Export course package, then download it from Downloads.',
      'In Udemy, create the course and add a section for each folder in the package, in the same order.',
      'Add a lecture for each video, upload it, and add its captions (the .vtt file next to it) under Captions.',
      'Attach each lecture’s notes and the downloads from the resources folder as lecture resources, then add the quizzes.',
    ],
  },
  {
    id: 'moodle',
    label: 'Moodle',
    logo: '/brand/platforms/moodle.svg',
    reason: 'Standard Moodle cannot add activities from another app, so the course goes in as one SCORM package.',
    packageKind: 'SCORM_PACKAGE',
    steps: [
      'On the course, open Generate and choose Export SCORM package, then download it from Downloads.',
      'In Moodle, open your course, turn editing on and choose Add an activity or resource, then SCORM package.',
      'Upload the ZIP and save. Progress and quiz scores report back to Moodle.',
    ],
  },
  {
    id: 'thinkific',
    label: 'Thinkific',
    logo: null,
    reason: 'Thinkific only accepts course content through its own course builder.',
    packageKind: 'SCORM_PACKAGE',
    steps: [
      'Export the SCORM package from the course and download it.',
      'In Thinkific, open the course builder, add a lesson and choose Multimedia, then SCORM.',
      'Upload the ZIP. For separate video lessons, use the course package ZIP and upload each video from its media folder.',
    ],
  },
  {
    id: 'teachable',
    label: 'Teachable',
    logo: null,
    reason: 'Teachable only accepts course content through its own course editor.',
    packageKind: 'COURSE_PACKAGE',
    steps: [
      'Export the course package from the course and download it.',
      'In Teachable, create a section for each folder and use Bulk Upload to add the lecture videos.',
      'Paste each lecture’s notes from the package, and attach the downloads from its resources folder.',
    ],
  },
]
