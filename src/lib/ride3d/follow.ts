/**
 * Where the 3D view's camera should be, given what the ride engine reports.
 *
 * The engine decides everything that matters (speed, distance, the trainer's
 * resistance) and reports it four times a second. The view draws sixty times
 * a second, so in between it carries on at the last reported speed, and
 * closes any gap to the engine gently rather than jumping. When reports stop
 * arriving it slows to a halt instead of riding on alone.
 *
 * Pure: time comes in as an argument, in seconds.
 */

export interface FollowedRide {
  status: string
  /** Metres along the route, or ridden so far when there is no route. */
  distance: number
  /** The route's length in metres; 0 when there is no route. */
  routeDistance: number
  speedMs: number
}

/** Keep extrapolating from the last report for at most this long. */
export const MAX_COAST_S = 1.5
/** A gap bigger than this is a jump (a new ride, a reset), not drift: go straight there. */
export const SNAP_M = 60
/** The share of a small gap closed per second. */
const CATCH_UP_PER_S = 2

export class Follower {
  /** Position along the drawn road, metres. */
  s = 0
  /** Real speed in metres per second, for anything that shows speed: wind, blur, field of view. */
  speedMs = 0

  readonly length: number
  readonly loop: boolean
  readonly scaleToRoute: boolean
  private last: { s: number; rate: number; speedMs: number; at: number } | null = null

  /**
   * @param length Length of the drawn road, metres.
   * @param loop Whether the drawn road joins up, so position wraps instead of stopping at the end.
   * @param scaleToRoute Whether the drawn road is the route itself, made from the same GPX. Only
   *   then is route distance stretched to fit it. Any other road, such as the invented valley, is
   *   ridden at true distance, round and round: stretching a 72 km route onto a 3 km loop made the
   *   rider crawl along at a twenty-fifth of their speed.
   */
  constructor(length: number, loop: boolean, scaleToRoute = true) {
    this.length = length
    this.loop = loop
    this.scaleToRoute = scaleToRoute
  }

  /**
   * Distance along the route to position on the drawn road. The two are
   * measured differently (along the GPS points, and along a smoothed curve
   * through them) so they differ slightly in length; scaling keeps the ends
   * of the ride at the ends of the road.
   */
  place(distance: number, routeDistance: number): number {
    const s = this.scaleToRoute && routeDistance > 0 ? (distance / routeDistance) * this.length : distance
    return this.normalise(s)
  }

  receive(ride: FollowedRide, now: number): void {
    const scale = this.scaleToRoute && ride.routeDistance > 0 ? this.length / ride.routeDistance : 1
    const speedMs = ride.status === 'riding' ? Math.max(0, ride.speedMs) : 0
    const s = this.place(ride.distance, ride.routeDistance)
    const first = this.last === null
    this.last = { s, rate: speedMs * scale, speedMs, at: now }
    if (first || Math.abs(this.gap(s, this.s)) > SNAP_M) this.s = s
  }

  step(dt: number, now: number): void {
    const last = this.last
    if (!last) return
    const since = Math.max(0, now - last.at)
    const fresh = since <= MAX_COAST_S
    const rate = fresh ? last.rate : 0
    this.speedMs = fresh ? last.speedMs : 0

    const expected = this.normalise(last.s + last.rate * Math.min(since, MAX_COAST_S))
    const moved = this.normalise(this.s + rate * dt)
    this.s = this.normalise(moved + this.gap(expected, moved) * Math.min(1, dt * CATCH_UP_PER_S))
  }

  /** The shortest way from `from` to `to`: round the loop if that is nearer. */
  private gap(to: number, from: number): number {
    const d = to - from
    if (!this.loop) return d
    const L = this.length
    return ((((d + L / 2) % L) + L) % L) - L / 2
  }

  private normalise(s: number): number {
    if (this.loop) return ((s % this.length) + this.length) % this.length
    return Math.min(this.length, Math.max(0, s))
  }
}
