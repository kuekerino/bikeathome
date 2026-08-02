/** Display helpers. Kept apart from the physics, which is all SI. */

/**
 * Gradient bands, roughly how a rider reads a road: flat-ish, rising, hard,
 * and a wall, mirrored for descents. Literal colours rather than CSS
 * variables because these are also used inside SVG gradient stops.
 */
export function gradientColour(percent: number): string {
  if (percent >= 10) return '#f85149'
  if (percent >= 6) return '#e8952e'
  if (percent >= 3) return '#d4c93a'
  if (percent >= -1) return '#3fb950'
  if (percent >= -5) return '#6fb8ff'
  return '#4ea1ff'
}

export function toKmh(speedMs: number): number {
  return speedMs * 3.6
}

export function formatSpeed(speedMs: number): string {
  return toKmh(speedMs).toFixed(1)
}

export function formatDistance(metres: number): string {
  return (metres / 1000).toFixed(2)
}

export function formatGradient(percent: number): string {
  return `${percent >= 0 ? '' : '-'}${Math.abs(percent).toFixed(1)}%`
}

/** H:MM:SS once past an hour, M:SS before that. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}
