/**
 * SOURCE OF TRUTH KEYWORDS: captionLanguageCode, ISO 639-2, subtitle
 *   language, LANGUAGE_CODES, course language code
 *
 * WHAT:  Maps the course brief's free-text language ("English", "French")
 *        to the ISO 639-2 code media containers use for subtitle tracks.
 * WHY:   Captions were always tagged English; players and LMSs show and
 *        pick tracks by this code. Unknown languages get `und` (undetermined)
 *        rather than a wrong tag.
 * WHERE: Video renderer agent (lecture MP4 subtitle track).
 */

const LANGUAGE_CODES: Record<string, string> = {
  english: 'eng',
  french: 'fra',
  spanish: 'spa',
  portuguese: 'por',
  german: 'deu',
  italian: 'ita',
  dutch: 'nld',
  arabic: 'ara',
  chinese: 'zho',
  mandarin: 'zho',
  japanese: 'jpn',
  korean: 'kor',
  hindi: 'hin',
  russian: 'rus',
  turkish: 'tur',
  polish: 'pol',
  swahili: 'swa',
  yoruba: 'yor',
  hausa: 'hau',
  igbo: 'ibo',
  twi: 'twi',
  akan: 'aka',
}

export function captionLanguageCode(language: string): string {
  const key = language.trim().toLowerCase().split(/[\s(,]/)[0] ?? ''
  return LANGUAGE_CODES[key] ?? 'und'
}

/* Two-letter (ISO 639-1) codes for the same languages, keyed alike. */
const WEB_LANGUAGE_CODES: Record<string, string> = {
  english: 'en',
  french: 'fr',
  spanish: 'es',
  portuguese: 'pt',
  german: 'de',
  italian: 'it',
  dutch: 'nl',
  arabic: 'ar',
  chinese: 'zh',
  mandarin: 'zh',
  japanese: 'ja',
  korean: 'ko',
  hindi: 'hi',
  russian: 'ru',
  turkish: 'tr',
  polish: 'pl',
  swahili: 'sw',
  yoruba: 'yo',
  hausa: 'ha',
  igbo: 'ig',
  twi: 'tw',
  akan: 'ak',
}

/**
 * SOURCE OF TRUTH KEYWORDS: webLanguageCode, BCP 47, ISO 639-1, YouTube
 *   defaultLanguage, caption language for platforms
 *
 * WHAT:  The course language as a short web language code ("en", "fr"), or
 *        null when it is not one we know.
 * WHY:   Publishing platforms (YouTube, Vimeo) validate language codes and
 *        reject the whole request for a free-text name like "English"; an
 *        unknown language is better left unset than sent wrong.
 * WHERE: YouTube and Vimeo publishers (src/lib/publishing).
 */
export function webLanguageCode(language: string): string | null {
  const key = language.trim().toLowerCase().split(/[\s(,]/)[0] ?? ''
  return WEB_LANGUAGE_CODES[key] ?? null
}
