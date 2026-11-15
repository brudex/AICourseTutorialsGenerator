import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * SOURCE OF TRUTH KEYWORDS: formatCurrency, PlanPrice, MINOR_UNITS,
 *   PricingCard, UpgradeModal
 *
 * WHAT:  Renders a provider amount in its MINOR unit (cents) as money — 4900 +
 *        'usd' → "$49".
 * WHY:   The billing provider states every amount in minor units, and how many
 *        of those make one unit is a property OF THE CURRENCY, not a constant:
 *        dividing by 100 turns ¥4900 into ¥49. Intl already knows the answer, so
 *        the divisor is read from the resolved format rather than hardcoded, and
 *        every pricing surface in the app formats through this one function.
 *        Trailing `.00` is dropped because a whole-number price reads better on
 *        a pricing card, while a 49.50 keeps its cents.
 * WHERE: <PricingCard /> and the billing-interval cards in
 *        src/components/global/upgrade-modal.
 */
export function formatCurrency(amountInMinorUnits: number, currency: string): string {
  const upper = currency.toUpperCase()
  /* An unknown/blank currency code makes Intl throw; falling back keeps a
   * misconfigured price from taking the whole pricing grid down. */
  let fractionDigits = 2
  try {
    fractionDigits =
      new Intl.NumberFormat('en-US', { style: 'currency', currency: upper })
        .resolvedOptions().minimumFractionDigits ?? 2
  } catch {
    return `${(amountInMinorUnits / 100).toFixed(2)} ${upper}`
  }

  const value = amountInMinorUnits / 10 ** fractionDigits
  const isWhole = Number.isInteger(value)

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: upper,
    minimumFractionDigits: isWhole ? 0 : fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value)
}

/**
 * SOURCE OF TRUTH KEYWORDS: slugify, url slug, file name slug, kebab case
 *
 * WHAT:  Lowercase, accent-free, dash-separated slug (max 60 chars).
 * WHY:   One implementation for course slugs and generated file paths
 *        (source code ZIP folders), so both normalise text the same way.
 * WHERE: courses.create (course slug), src/lib/render/source-archive.ts.
 */
export function slugify(value: string, fallback = 'item'): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || fallback
  )
}

/**
 * SOURCE OF TRUTH KEYWORDS: formatBytes, file size label, KB, MB
 *
 * WHAT:  Human file size ("840 KB", "2.4 MB").
 * WHERE: MaterialList (course downloads).
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * SOURCE OF TRUTH KEYWORDS: formatMinutes, course length label, duration text
 *
 * WHAT:  "45 min", "2 h", "3 h 15 min".
 * WHERE: School catalogue, course page and home sections.
 */
export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/**
 * SOURCE OF TRUTH KEYWORDS: formatPageRange, book pages label, page range
 *
 * WHAT:  "12–18" for a range, "12" for a single page.
 * WHERE: Curriculum editor and CourseBookCard (course book pages).
 */
export function formatPageRange(start: number, end: number): string {
  return start === end ? String(start) : `${start}–${end}`
}

/**
 * SOURCE OF TRUTH KEYWORDS: initialsOf, avatar initials, avatar fallback
 *
 * WHAT:  Two-letter initials from a name, falling back to the email.
 * WHERE: UserIdentity (team table, member detail), the sidebar user menu.
 */
export function initialsOf(name: string | null | undefined, email: string): string {
  const source = name?.trim() || email
  const parts = source.split(/\s+/).filter(Boolean)
  const letters = parts.length >= 2 ? `${parts[0]?.[0]}${parts[1]?.[0]}` : source.slice(0, 2)
  return letters.toUpperCase()
}

/**
 * SOURCE OF TRUTH KEYWORDS: describeUserAgent, device name, browser and OS,
 *   session device label, user agent parsing
 *
 * WHAT:  A short "Browser on OS" label from a user agent string.
 * WHY:   Session lists need a readable device name; a full parser library is
 *        overkill for the handful of browsers and systems people sign in from.
 *        Order matters: Edge and Opera also contain "Chrome", and Chrome
 *        contains "Safari".
 * WHERE: Active sessions on the account screen.
 */
export function describeUserAgent(userAgent: string | null | undefined): string {
  if (!userAgent) return 'Unknown device'
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : /AppleWebKit/.test(userAgent)
              ? 'Desktop app'
              : 'Browser'
  const os = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Mac OS X|Macintosh/.test(userAgent)
        ? 'macOS'
        : /Windows/.test(userAgent)
          ? 'Windows'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null
  return os ? `${browser} on ${os}` : browser
}

/**
 * SOURCE OF TRUTH KEYWORDS: displayIpAddress, loopback address, localhost IP,
 *   session IP label, IPv6 loopback
 *
 * WHAT:  The IP address worth showing next to a session, or null.
 * WHY:   Local and desktop installs record the loopback address (127.0.0.1,
 *        ::1, or its expanded 0000:…:0001 form), which tells the person
 *        nothing and fills the row.
 * WHERE: Active sessions on the account screen.
 */
export function displayIpAddress(ip: string | null | undefined): string | null {
  if (!ip) return null
  const value = ip.trim()
  const isLoopback = /^127\./.test(value) || /^[0:]*:0*1?$/.test(value) || /^::ffff:127\./i.test(value)
  return isLoopback || value.length === 0 ? null : value
}

/**
 * SOURCE OF TRUTH KEYWORDS: splitEmailList, parse pasted emails
 * WHAT:  Splits pasted text (commas, semicolons, spaces or new lines) into
 *        unique lowercase emails, in order.
 * WHERE: Invite students dialog (the router validates each email again).
 */
export function splitEmailList(text: string): string[] {
  return [...new Set(text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))]
}
