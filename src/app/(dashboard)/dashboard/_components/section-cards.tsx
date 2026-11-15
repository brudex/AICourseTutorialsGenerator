'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: SectionCards, dashboard KPI cards, trend badge,
 *   courses KPI, lectures this week, video minutes, AI tokens trend
 *
 * WHAT:  The four KPI cards at the top of the dashboard (shadcn dashboard-01
 *        "section cards"): courses, lectures written, video minutes and AI
 *        tokens, each with a trend badge and a two-line footer.
 * WHY:   Follows the dashboard-01 block: headline number, a badge with the
 *        recent change, and a footer that says what the number means. The
 *        token card only appears for members who may read AI usage.
 * WHERE: DashboardHome.
 */

import { BookOpenIcon, ClapperboardIcon, FileTextIcon, SparklesIcon, TrendingDownIcon, TrendingUpIcon, type LucideIcon } from 'lucide-react'

import type { DashboardCourses, DashboardUsage } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

interface KpiCardProps {
  label: string
  value: string | number
  badge: string | null
  trend: 'up' | 'down' | 'flat'
  headline: string
  detail: string
  icon: LucideIcon
}

function KpiCard({ label, value, badge, trend, headline, detail, icon: Icon }: KpiCardProps) {
  const TrendIcon = trend === 'down' ? TrendingDownIcon : TrendingUpIcon
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{value}</CardTitle>
        {badge ? (
          <CardAction>
            <Badge variant="outline">
              {trend !== 'flat' ? <TrendIcon /> : null}
              {badge}
            </Badge>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardFooter className="flex-col items-start gap-1.5 text-sm">
        <div className="line-clamp-1 flex items-center gap-2 font-medium">
          {headline} <Icon className="size-4" />
        </div>
        <div className="text-muted-foreground">{detail}</div>
      </CardFooter>
    </Card>
  )
}

export function SectionCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-40 w-full rounded-xl" />
      ))}
    </div>
  )
}

export function SectionCards({ courses, usage }: { courses: DashboardCourses; usage: DashboardUsage | null }) {
  const change = usage?.tokensChange ?? null
  return (
    <div className="grid grid-cols-1 gap-4 *:data-[slot=card]:shadow-xs @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      <KpiCard
        label="Courses"
        value={courses.total}
        badge={courses.inProgress > 0 ? `${courses.inProgress} in progress` : null}
        trend="flat"
        headline={`${courses.ready} ready · ${courses.inReview} in review`}
        detail={courses.failed > 0 ? `${courses.failed} need attention` : 'Nothing needs attention'}
        icon={BookOpenIcon}
      />
      <KpiCard
        label="Lectures written"
        value={courses.lectures}
        badge={`+${courses.lecturesThisWeek} this week`}
        trend={courses.lecturesThisWeek > 0 ? 'up' : 'flat'}
        headline={`${courses.videos} with a finished video`}
        detail="Across every course"
        icon={FileTextIcon}
      />
      <KpiCard
        label="Video minutes"
        value={courses.videoMinutes}
        badge={`+${courses.videoMinutesThisWeek} min this week`}
        trend={courses.videoMinutesThisWeek > 0 ? 'up' : 'flat'}
        headline="Narrated and captioned"
        detail="Ready to preview and export"
        icon={ClapperboardIcon}
      />
      {usage ? (
        <KpiCard
          label="AI tokens, last 30 days"
          value={compact.format(usage.tokens)}
          badge={change === null ? null : `${change > 0 ? '+' : ''}${change}%`}
          trend={change === null || change === 0 ? 'flat' : change > 0 ? 'up' : 'down'}
          headline={`${compact.format(usage.calls)} model calls`}
          detail={usage.calls > 0 ? `${Math.round((usage.failed / usage.calls) * 100)}% failed and retried` : 'No calls yet'}
          icon={SparklesIcon}
        />
      ) : null}
    </div>
  )
}
