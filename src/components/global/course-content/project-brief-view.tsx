/**
 * SOURCE OF TRUTH KEYWORDS: ProjectBriefView, final project view, rubric,
 *   milestones, starter files
 *
 * WHAT:  Renders the final project brief: summary, outcomes, milestones with
 *        tasks and deliverables, starter files, rubric with points, stretch
 *        goals, and (author view only) the reference solution.
 * WHERE: Course Practice tab (author) and learner player (learner).
 */

import { FileCodeIcon, FlagIcon, TrophyIcon } from 'lucide-react'

import type { ProjectBrief } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function FileList({ files }: { files: ProjectBrief['starterFiles'] }) {
  return (
    <div className="space-y-2">
      {files.map((file) => (
        <details key={file.path} className="rounded-md border">
          <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 font-mono text-xs">
            <FileCodeIcon className="size-3.5" /> {file.path}
          </summary>
          <pre className="overflow-x-auto border-t bg-muted p-3 font-mono text-xs">{file.content}</pre>
        </details>
      ))}
    </div>
  )
}

export function ProjectBriefView({ project, showSolution }: { project: ProjectBrief; showSolution: boolean }) {
  const totalPoints = project.rubric.reduce((sum, r) => sum + r.points, 0)
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrophyIcon className="size-5" /> {project.title}
          </CardTitle>
          <CardDescription>About {project.estimatedHours} hours</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="whitespace-pre-line">{project.summary}</p>
          <div className="flex flex-wrap gap-1">
            {project.objectiveRefs.map((ref) => (
              <Badge key={ref} variant="outline">
                {ref}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <p className="font-semibold">Milestones</p>
        <ol className="space-y-3">
          {project.milestones.map((m, i) => (
            <li key={m.title} className="rounded-xl border bg-card p-4">
              <p className="flex items-center gap-2 font-medium">
                <span className="flex size-6 items-center justify-center rounded-full border text-xs">{i + 1}</span>
                {m.title}
              </p>
              {m.description ? <p className="mt-1 text-sm text-muted-foreground">{m.description}</p> : null}
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {m.tasks.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <FlagIcon className="size-3.5" /> Deliverable: {m.deliverable}
              </p>
            </li>
          ))}
        </ol>
      </div>

      {project.starterFiles.length > 0 ? (
        <div className="space-y-2">
          <p className="font-semibold">Starter files</p>
          <FileList files={project.starterFiles} />
        </div>
      ) : null}

      <div className="space-y-2">
        <p className="font-semibold">Rubric · {totalPoints} points</p>
        <div className="divide-y rounded-xl border">
          {project.rubric.map((r) => (
            <div key={r.criterion} className="flex items-start justify-between gap-4 p-3 text-sm">
              <div>
                <p className="font-medium">{r.criterion}</p>
                <p className="text-muted-foreground">{r.description}</p>
              </div>
              <span className="shrink-0 font-mono tabular-nums">{r.points} pts</span>
            </div>
          ))}
        </div>
      </div>

      {project.stretchGoals.length > 0 ? (
        <div className="space-y-2">
          <p className="font-semibold">Stretch goals</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {project.stretchGoals.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {showSolution && project.referenceSolution.length > 0 ? (
        <div className="space-y-2">
          <p className="font-semibold">Reference solution (instructors only)</p>
          <FileList files={project.referenceSolution} />
        </div>
      ) : null}
    </div>
  )
}
