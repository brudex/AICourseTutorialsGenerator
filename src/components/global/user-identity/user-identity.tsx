/**
 * SOURCE OF TRUTH KEYWORDS: UserIdentity, avatar name email, person cell,
 *   member identity, badge slot
 *
 * WHAT:  Avatar with name and email, plus an optional slot after the name
 *        (e.g. a "You" badge). Sizes: sm for table rows, lg for headers.
 * WHY:   Every place that shows a person (team table, member detail, later
 *        audit rows) renders them the same way.
 * WHERE: MemberManager table, MemberDetailSheet.
 */

import * as React from 'react'

import { cn, initialsOf } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

export interface UserIdentityProps {
  name: string
  email: string
  image: string | null
  size?: 'sm' | 'lg'
  /** Rendered next to the name. */
  adornment?: React.ReactNode
  className?: string
}

export function UserIdentity({ name, email, image, size = 'sm', adornment, className }: UserIdentityProps) {
  const large = size === 'lg'
  return (
    <div className={cn('flex min-w-0 items-center gap-3', className)}>
      <Avatar className={cn('shrink-0', large ? 'size-14' : 'size-9')}>
        {image ? <AvatarImage src={image} alt={name} /> : null}
        <AvatarFallback className={large ? 'text-base' : 'text-xs'}>{initialsOf(name, email)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <p className={cn('truncate font-medium', large ? 'text-lg' : 'text-sm')}>{name}</p>
          {adornment}
        </div>
        <p className={cn('truncate text-muted-foreground', large ? 'text-sm' : 'text-xs')}>{email}</p>
      </div>
    </div>
  )
}
