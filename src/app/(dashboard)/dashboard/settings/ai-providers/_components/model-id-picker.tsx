'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: ModelIdPicker, model id combobox, provider model
 *   list, recommended models, custom model id
 *
 * WHAT:  Searchable combobox for a model id: Recommended starter models (with
 *        name and capabilities), then every model the provider reports for
 *        this key, plus "Use …" for any id that is not listed.
 * WHY:   Users should pick from what actually exists rather than recall exact
 *        ids. Same Popover + Command pattern as the team RoleCommandSelector.
 *        A free-typed id stays possible because some providers do not list
 *        every model (or list none).
 * WHERE: ModelDialog.
 */

import * as React from 'react'
import { Check, ChevronDown, Loader2Icon, PlusIcon } from 'lucide-react'

import type { SuggestedAiModel } from '@/lib/config'
import { AI_CAPABILITY_LABELS } from '@/lib/config'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'

interface ModelIdPickerProps {
  value: string
  onChange: (modelId: string) => void
  suggestions: readonly SuggestedAiModel[]
  available: readonly string[]
  loading: boolean
  loadError: string | null
  disabled?: boolean
}

export function ModelIdPicker({ value, onChange, suggestions, available, loading, loadError, disabled = false }: ModelIdPickerProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')

  const suggestedIds = new Set(suggestions.map((s) => s.modelId))
  const others = available.filter((id) => !suggestedIds.has(id))
  const typed = search.trim()
  const isListed = typed === '' || suggestedIds.has(typed) || available.includes(typed)
  const suggestion = suggestions.find((s) => s.modelId === value)

  function pick(id: string) {
    onChange(id)
    setOpen(false)
    setSearch('')
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-10 w-full justify-between font-normal"
            disabled={disabled}
          />
        }
      >
        <span className={cn('truncate', !value && 'text-muted-foreground')}>
          {value ? (suggestion ? `${suggestion.displayName} · ${value}` : value) : 'Select a model'}
        </span>
        <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-[var(--anchor-width)] min-w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search models or type an id" value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>
              {loading ? 'Loading models…' : 'No models found. Type an id to use it.'}
            </CommandEmpty>

            {suggestions.length > 0 ? (
              <CommandGroup heading="Recommended">
                {suggestions.map((s) => (
                  <CommandItem key={s.modelId} value={`${s.modelId} ${s.displayName}`} onSelect={() => pick(s.modelId)}>
                    <Check className={cn('size-4', value === s.modelId ? 'opacity-100' : 'opacity-0')} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{s.displayName}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{s.modelId}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      {s.capabilities.slice(0, 2).map((c) => (
                        <Badge key={c} variant="outline" className="text-[10px]">
                          {AI_CAPABILITY_LABELS[c].label.split(' (')[0]}
                        </Badge>
                      ))}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}

            {suggestions.length > 0 && (others.length > 0 || loading) ? <CommandSeparator /> : null}

            <CommandGroup heading="Available with your key">
              {loading ? (
                <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                  <Loader2Icon className="size-3.5 animate-spin" /> Loading models from the provider…
                </div>
              ) : loadError ? (
                <p className="px-2 py-2 text-xs text-destructive">{loadError}</p>
              ) : others.length === 0 ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">The provider did not list any other models.</p>
              ) : (
                others.map((id) => (
                  <CommandItem key={id} value={id} onSelect={() => pick(id)}>
                    <Check className={cn('size-4', value === id ? 'opacity-100' : 'opacity-0')} />
                    <span className="truncate font-mono text-xs">{id}</span>
                  </CommandItem>
                ))
              )}
            </CommandGroup>

            {!isListed ? (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem value={`use ${typed}`} onSelect={() => pick(typed)}>
                    <PlusIcon className="size-4" />
                    <span className="truncate">
                      Use <span className="font-mono">{typed}</span>
                    </span>
                  </CommandItem>
                </CommandGroup>
              </>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
