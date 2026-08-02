/** Display formatting. Kept apart from the physics, which is all SI. */

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
