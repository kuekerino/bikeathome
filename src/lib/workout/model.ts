/**
 * A structured workout: what power to hold, and for how long.
 *
 * Two shapes, deliberately. A workout is authored and stored as a *tree*,
 * because `6 × (3 min hard, 3 min easy)` is how a session is thought about and
 * how it should be displayed — a rider wants "interval 4 of 6", not "step 8 of
 * 13". It is *flattened* to run, because a clock only ever needs to know which
 * step it is in. Flattening keeps a reference back to the repeat, so the
 * display never loses what the tree knew.
 */

/**
 * What to hold. Absolute watts and a fraction of FTP are both first-class:
 * published sessions are written in percentages, but a test protocol has to be
 * written in watts — an FTP test cannot be expressed as a share of the number
 * it exists to measure.
 */
export type Intensity =
  | { kind: 'watts'; watts: number }
  | { kind: 'ftp'; fraction: number }
  /** No target at all — the trainer goes back to the gradient. */
  | { kind: 'free' }

export interface WorkoutStep {
  seconds: number
  /** Equal to {@link WorkoutStep.to} for a steady step; different for a ramp. */
  from: Intensity
  to: Intensity
  /** Suggested cadence, which ERG otherwise leaves entirely up to the rider. */
  cadenceRpm?: number
  label?: string
}

export type WorkoutBlock =
  | { kind: 'step'; step: WorkoutStep }
  | { kind: 'repeat'; times: number; steps: WorkoutStep[] }

export interface Workout {
  name: string
  description?: string
  blocks: WorkoutBlock[]
}

export interface FlatStep {
  step: WorkoutStep
  /** Seconds into the workout at which this step begins. */
  startSeconds: number
  endSeconds: number
  /** Which pass through a repeat this is, one-based. Absent outside a repeat. */
  repeat?: { index: number; total: number }
}

export function flatten(workout: Workout): FlatStep[] {
  const flat: FlatStep[] = []
  let at = 0

  for (const block of workout.blocks) {
    if (block.kind === 'step') {
      flat.push({ step: block.step, startSeconds: at, endSeconds: at + block.step.seconds })
      at += block.step.seconds
      continue
    }

    for (let pass = 1; pass <= block.times; pass++) {
      for (const step of block.steps) {
        flat.push({
          step,
          startSeconds: at,
          endSeconds: at + step.seconds,
          repeat: { index: pass, total: block.times },
        })
        at += step.seconds
      }
    }
  }

  return flat
}

export function totalSeconds(steps: readonly FlatStep[]): number {
  return steps[steps.length - 1]?.endSeconds ?? 0
}

/** The step in force at `seconds`, or `undefined` once the workout is over. */
export function stepAt(steps: readonly FlatStep[], seconds: number): FlatStep | undefined {
  // A linear walk: workouts are tens of steps, and the caller asks four times
  // a second. Anything cleverer would be harder to read for no gain.
  return steps.find((s) => seconds >= s.startSeconds && seconds < s.endSeconds)
}

/**
 * Watts to hold, or `null` when the step asks for no target at all.
 *
 * Returns `null` for a relative step with no FTP set, rather than guessing:
 * silently riding 60% of a number nobody chose is worse than not starting.
 */
export function resolveIntensity(intensity: Intensity, ftpW: number | null): number | null {
  if (intensity.kind === 'free') return null
  if (intensity.kind === 'watts') return intensity.watts
  return ftpW === null ? null : intensity.fraction * ftpW
}

/** Watts at a moment inside a step, interpolating across a ramp. */
export function wattsAt(step: WorkoutStep, secondsIntoStep: number, ftpW: number | null): number | null {
  const from = resolveIntensity(step.from, ftpW)
  const to = resolveIntensity(step.to, ftpW)
  if (from === null || to === null) return null
  if (from === to || step.seconds <= 0) return from

  const progress = Math.min(1, Math.max(0, secondsIntoStep / step.seconds))
  return from + (to - from) * progress
}

/** Whether anything in here needs an FTP before it can be ridden. */
export function needsFtp(workout: Workout): boolean {
  const relative = (i: Intensity) => i.kind === 'ftp'
  return workout.blocks.some((block) =>
    block.kind === 'step'
      ? relative(block.step.from) || relative(block.step.to)
      : block.steps.some((s) => relative(s.from) || relative(s.to)),
  )
}

/** A one-line summary of a step, for the panel and the step list. */
export function describeStep(step: WorkoutStep, ftpW: number | null): string {
  if (step.from.kind === 'free' || step.to.kind === 'free') return 'Free ride'

  const from = resolveIntensity(step.from, ftpW)
  const to = resolveIntensity(step.to, ftpW)
  if (from === null || to === null) return 'needs an FTP'

  return from === to
    ? `${Math.round(from)} W`
    : `${Math.round(from)} → ${Math.round(to)} W`
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}
