/**
 * How long one beat lasts, for an animation that keeps time with a real heart.
 *
 * Clamped at both ends. A strap that glitches to 250 bpm would otherwise
 * produce a flicker rather than a pulse, and one reporting 30 would leave the
 * heart apparently stopped — neither is information, and both look broken.
 */
export function beatSeconds(bpm: number): number {
  if (!Number.isFinite(bpm) || bpm <= 0) return 1
  return Math.min(1.5, Math.max(0.25, 60 / bpm))
}
