'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: NewCourseStart, new course modes, from a course
 *   book, describe a topic
 *
 * WHAT:  The new-course page body: a heading and two ways to start, "From a
 *        course book" (just upload the PDF) or "Describe a topic" (the brief
 *        form).
 * WHY:   Book-first is the quickest path and needs nothing but the file, so it
 *        is the default tab; the brief form stays for topics without a book.
 * WHERE: /dashboard/courses/new.
 */

import { BookOpenIcon, PencilLineIcon } from 'lucide-react'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BookCourseForm } from './book-course-form'
import { CourseBriefForm } from './course-brief-form'

export function NewCourseStart() {
  return (
    <div className="space-y-8">
      <Tabs defaultValue="book" className="gap-6">
        <TabsList>
          <TabsTrigger value="book" className="gap-1.5">
            <BookOpenIcon className="size-4" />
            From a course book
          </TabsTrigger>
          <TabsTrigger value="topic" className="gap-1.5">
            <PencilLineIcon className="size-4" />
            Describe a topic
          </TabsTrigger>
        </TabsList>
        <TabsContent value="book">
          <BookCourseForm />
        </TabsContent>
        <TabsContent value="topic">
          <CourseBriefForm />
        </TabsContent>
      </Tabs>
    </div>
  )
}
