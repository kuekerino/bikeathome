<script lang="ts">
  import { gradientColour } from '../lib/format'
  import type { Route } from '../lib/gpx/route'

  interface Props {
    route: Route
    /** How far along the rider is, in metres. */
    distance: number
  }

  let { route, distance }: Props = $props()

  /**
   * Resampled at a fixed count rather than drawn point-for-point: a long ride
   * can carry thousands of points, and at screen resolution the difference is
   * invisible while the SVG is an order of magnitude smaller.
   */
  const SAMPLES = 160
  const WIDTH = 1000
  const HEIGHT = 100

  const profile = $derived.by(() => {
    const points = Array.from({ length: SAMPLES + 1 }, (_, i) => {
      const along = (i / SAMPLES) * route.totalDistance
      const { ele, gradient } = route.pointAt(along)
      return { x: (i / SAMPLES) * WIDTH, offset: i / SAMPLES, ele, gradient }
    })

    const elevations = points.map((p) => p.ele)
    const low = Math.min(...elevations)
    const high = Math.max(...elevations)
    // Flat routes would divide by zero and spike; give them a floor.
    const span = Math.max(high - low, 10)

    const line = points
      .map((p) => `${p.x.toFixed(1)},${(HEIGHT - ((p.ele - low) / span) * (HEIGHT - 8)).toFixed(1)}`)
      .join(' L')

    return { points, low, high, line, fill: `M0,${HEIGHT} L${line} L${WIDTH},${HEIGHT} Z` }
  })

  const progress = $derived(
    route.totalDistance > 0 ? Math.min(1, Math.max(0, distance / route.totalDistance)) : 0,
  )
  const marker = $derived(progress * WIDTH)
  const here = $derived(route.pointAt(distance))
</script>

<figure>
  <svg viewBox="0 0 {WIDTH} {HEIGHT}" preserveAspectRatio="none" role="img"
       aria-label="Elevation profile, {Math.round(profile.low)} to {Math.round(profile.high)} metres">
    <defs>
      <linearGradient id="steepness" x1="0" x2="1" y1="0" y2="0">
        {#each profile.points as point (point.offset)}
          <stop offset={point.offset} stop-color={gradientColour(point.gradient)} />
        {/each}
      </linearGradient>
      <clipPath id="ridden">
        <rect x="0" y="0" width={marker} height={HEIGHT} />
      </clipPath>
    </defs>

    <path d={profile.fill} fill="#1c232c" />
    <path d={profile.fill} fill="#2f3b49" clip-path="url(#ridden)" />
    <path
      d="M{profile.line}"
      fill="none"
      stroke="url(#steepness)"
      stroke-width="2.5"
      vector-effect="non-scaling-stroke"
    />
    <line
      x1={marker}
      x2={marker}
      y1="0"
      y2={HEIGHT}
      stroke="var(--accent)"
      stroke-width="2"
      vector-effect="non-scaling-stroke"
    />
  </svg>

  <figcaption>
    <span>{Math.round(profile.low)} m</span>
    <span class="here num">{Math.round(here.ele)} m</span>
    <span>{Math.round(profile.high)} m</span>
  </figcaption>
</figure>

<style>
  figure {
    margin: 0;
  }

  svg {
    display: block;
    width: 100%;
    height: 160px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  figcaption {
    display: flex;
    justify-content: space-between;
    padding-top: 0.35rem;
    font-size: 0.75rem;
    color: var(--muted);
  }

  .here {
    color: var(--text);
  }
</style>
