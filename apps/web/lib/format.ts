const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["week", 604_800_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1_000],
]

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

/**
 * "2 minutes ago". Renders on the server and again on the client, a moment
 * apart, so callers mark the element `suppressHydrationWarning` rather than
 * letting a one-minute drift produce a hydration error.
 */
export function relativeTime(iso: string): string {
  const elapsed = new Date(iso).getTime() - Date.now()
  const magnitude = Math.abs(elapsed)

  for (const [unit, ms] of RELATIVE_UNITS) {
    if (magnitude >= ms) {
      return relative.format(Math.round(elapsed / ms), unit)
    }
  }
  return "just now"
}

/** 2_700 -> "45m", 5_400 -> "1h 30m". */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "Not set"
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.round((seconds % 3_600) / 60)
  if (hours === 0) return `${minutes}m`
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}

/** Shorten a token for display. The full link is still copyable. */
export function shortenToken(token: string): string {
  return token.length <= 12 ? token : `${token.slice(0, 6)}…${token.slice(-3)}`
}
