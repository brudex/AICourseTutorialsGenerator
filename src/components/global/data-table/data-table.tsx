'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: DataTable, DataTableColumn, data table, table
 *   toolbar, search, filters slot, actions slot, row click, pagination,
 *   loading skeleton, empty state
 *
 * WHAT:  A typed, reusable table: a toolbar (search box, a filters slot, an
 *        actions slot), the rows from column definitions, a skeleton while
 *        the first page loads, an empty slot, and the shared ListPagination.
 * WHY:   The table owns the repeatable parts (layout, search box, loading,
 *        dimming while a new page loads, the pager, responsive columns);
 *        everything specific (cells, filters, row actions, what a click
 *        opens) comes in as props, so any list in the app plugs in without
 *        a new table. Data stays server-paginated: the caller passes one page
 *        of rows and the page numbers.
 * WHERE: MemberManager (team table). Ready for courses and other lists.
 */

import * as React from 'react'
import { SearchIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ListPagination, type ListPaginationProps } from '@/components/global/list-pagination'

export interface DataTableColumn<T> {
  id: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  className?: string
  /** Hides the column below this breakpoint so narrow screens keep the essentials. */
  hideBelow?: 'sm' | 'md' | 'lg'
  align?: 'left' | 'right'
}

export interface DataTableProps<T> {
  columns: ReadonlyArray<DataTableColumn<T>>
  rows: readonly T[]
  rowKey: (row: T) => string
  onRowClick?: (row: T) => void
  /** First load: shows skeleton rows. */
  isLoading?: boolean
  /** A new page or filter is loading: dims the current rows. */
  isFetching?: boolean
  search?: { value: string; onChange: (value: string) => void; placeholder: string }
  filters?: React.ReactNode
  actions?: React.ReactNode
  empty: React.ReactNode
  pagination?: ListPaginationProps | undefined
  skeletonRows?: number
}

const HIDE_BELOW: Record<NonNullable<DataTableColumn<never>['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  isLoading = false,
  isFetching = false,
  search,
  filters,
  actions,
  empty,
  pagination,
  skeletonRows = 5,
}: DataTableProps<T>) {
  const columnClass = (column: DataTableColumn<T>) =>
    cn(column.hideBelow && HIDE_BELOW[column.hideBelow], column.align === 'right' && 'text-right', column.className)

  return (
    <div className="space-y-4">
      {search || filters || actions ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            {search ? (
              <div className="relative w-full sm:max-w-xs">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  value={search.value}
                  onChange={(event) => search.onChange(event.target.value)}
                  placeholder={search.placeholder}
                  aria-label={search.placeholder}
                  maxLength={120}
                  className="pl-8"
                />
              </div>
            ) : null}
            {filters}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}

      <div className={cn('overflow-hidden rounded-lg border bg-card transition-opacity', isFetching && !isLoading && 'opacity-60')}>
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              {columns.map((column) => (
                <TableHead key={column.id} className={cn('h-10 text-xs font-medium text-muted-foreground', columnClass(column))}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: skeletonRows }, (_, index) => (
                <TableRow key={index} className="hover:bg-transparent">
                  {columns.map((column) => (
                    <TableCell key={column.id} className={columnClass(column)}>
                      <Skeleton className="h-5 w-full max-w-40" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="py-14 text-center">
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    onRowClick
                      ? (event) => {
                          if (event.key === 'Enter') onRowClick(row)
                        }
                      : undefined
                  }
                  tabIndex={onRowClick ? 0 : undefined}
                  className={cn(onRowClick && 'cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none')}
                >
                  {columns.map((column) => (
                    <TableCell key={column.id} className={cn('py-3', columnClass(column))}>
                      {column.cell(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.total > 0 ? <ListPagination {...pagination} /> : null}
    </div>
  )
}
