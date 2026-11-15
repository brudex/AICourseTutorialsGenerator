'use client'

/**
 * SOURCE OF TRUTH KEYWORDS: UsageChart, AI usage chart, tokens per day,
 *   input output tokens, interactive area chart, usage range toggle
 *
 * WHAT:  AI tokens per day for the last 90, 30 or 7 days as a stacked area
 *        chart (input and output tokens), with a range toggle (a select on
 *        narrow cards) and the period's totals in the header.
 * WHY:   Adapted from the shadcn dashboard-01 interactive area chart. Two
 *        series, so a legend is shown; colors come from the theme's chart
 *        tokens. Days without calls are zero-filled by the server so the axis
 *        never skips.
 * WHERE: DashboardHome (needs aiProviders:read).
 */

import * as React from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'

import { trpc } from '@/trpc/react-provider'
import { formatCostMicros } from '@/lib/ai/cost'
import { USAGE_RANGES, type UsageRange } from '@/lib/types'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

const RANGE_LABELS: Record<UsageRange, string> = { 90: 'Last 3 months', 30: 'Last 30 days', 7: 'Last 7 days' }
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

const chartConfig = {
  input: { label: 'Input tokens', color: 'var(--chart-2)' },
  output: { label: 'Output tokens', color: 'var(--chart-1)' },
} satisfies ChartConfig

function isRange(value: string | null | undefined): value is `${UsageRange}` {
  return USAGE_RANGES.some((range) => String(range) === value)
}

function dayLabel(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function UsageChart({ organizationId }: { organizationId: string }) {
  const [days, setDays] = React.useState<UsageRange>(30)
  const usage = trpc.dashboard.usage.useQuery({ organizationId, days }, { placeholderData: (previous) => previous })
  const data = usage.data
  const pick = (value: string | null | undefined) => {
    if (isRange(value)) setDays(Number(value) as UsageRange)
  }

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>AI usage</CardTitle>
        <CardDescription>
          {data
            ? `${compact.format(data.tokens)} tokens · ${compact.format(data.calls)} calls · ${formatCostMicros(data.costMicros)} · ${RANGE_LABELS[days].toLowerCase()}`
            : RANGE_LABELS[days]}
        </CardDescription>
        <CardAction>
          <ToggleGroup
            multiple={false}
            value={[String(days)]}
            onValueChange={(value) => pick(value[0])}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            {[...USAGE_RANGES].reverse().map((range) => (
              <ToggleGroupItem key={range} value={String(range)}>
                {RANGE_LABELS[range]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select value={String(days)} onValueChange={pick}>
            <SelectTrigger className="flex w-40 @[767px]/card:hidden" size="sm" aria-label="Select a range">
              <SelectValue>{(value: string) => (isRange(value) ? RANGE_LABELS[Number(value) as UsageRange] : value)}</SelectValue>
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {[...USAGE_RANGES].reverse().map((range) => (
                <SelectItem key={range} value={String(range)} className="rounded-lg">
                  {RANGE_LABELS[range]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {!data ? (
          <Skeleton className="h-[250px] w-full" />
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
            <AreaChart data={data.days} margin={{ left: 4, right: 8 }}>
              <defs>
                <linearGradient id="fillOutput" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-output)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--color-output)" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="fillInput" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-input)" stopOpacity={0.6} />
                  <stop offset="95%" stopColor="var(--color-input)" stopOpacity={0.1} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={8} minTickGap={32} tickFormatter={dayLabel} />
              <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={(value: number) => compact.format(value)} />
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent labelFormatter={(value) => dayLabel(String(value))} indicator="dot" />}
              />
              <Area dataKey="input" type="monotone" fill="url(#fillInput)" stroke="var(--color-input)" strokeWidth={2} stackId="tokens" />
              <Area dataKey="output" type="monotone" fill="url(#fillOutput)" stroke="var(--color-output)" strokeWidth={2} stackId="tokens" />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
