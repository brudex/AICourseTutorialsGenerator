/**
 * SOURCE OF TRUTH KEYWORDS:⁠​‌‌​​‌‌​​‌​‌‌‌​​‌‌​‌​​​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​‌‌‌‌​​​‌​​‌​‌​​​‌​​‌‌‌⁠ books barrel, readCourseBook, CourseBookError
 *
 * WHAT:  Course book reading (PDF → chapters with page text).
 * WHERE: Imported as '@/lib/books' by the courseBooks router.
 */

export { readCourseBook, assembleScannedBook, renderBookPages, CourseBookError } from './read-book'
