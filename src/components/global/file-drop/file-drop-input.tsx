'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: FileDropInput, file upload, drag and drop,
 *   file picker, dropzone, controlled file field
 *
 * WHAT:  A controlled single-file picker: drop a file on it or click to
 *        browse; shows the chosen file with its size and a remove button.
 * WHY:   Uploads are validated by Zod through React Hook Form, so this field
 *        only reports the File (or null) via `onChange` and never decides
 *        what is valid. `accept`, the label and the hint are props, so any
 *        upload (a course book, later images or slides) reuses it.
 * WHERE: New-course form (course book) and CourseBookCard (replace book).
 */

import * as React from 'react'
import { FileIcon, UploadIcon, XIcon } from 'lucide-react'

import { cn, formatBytes } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export interface FileDropInputProps {
  value: File | null
  onChange: (file: File | null) => void
  accept: string
  label: string
  hint?: string
  disabled?: boolean
  id?: string
}

export function FileDropInput({ value, onChange, accept, label, hint, disabled = false, id }: FileDropInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = React.useState(false)

  function pick(files: FileList | null) {
    onChange(files?.[0] ?? null)
    if (inputRef.current) inputRef.current.value = ''
  }

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
        <FileIcon className="size-5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{value.name}</p>
          <p className="text-xs text-muted-foreground">{formatBytes(value.size)}</p>
        </div>
        <Button type="button" variant="ghost" size="icon" aria-label="Remove file" disabled={disabled} onClick={() => onChange(null)}>
          <XIcon className="size-4" />
        </Button>
      </div>
    )
  }

  return (
    <label
      htmlFor={id}
      onDragOver={(event) => {
        event.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault()
        setDragging(false)
        if (!disabled) pick(event.dataTransfer.files)
      }}
      className={cn(
        'flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center transition-colors hover:bg-muted/50',
        dragging && 'border-foreground bg-muted',
        disabled && 'pointer-events-none opacity-60'
      )}
    >
      <UploadIcon className="size-5 text-muted-foreground" />
      <span className="text-sm font-medium">{label}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      <input
        ref={inputRef}
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => pick(event.target.files)}
      />
    </label>
  )
}
