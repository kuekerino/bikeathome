<script lang="ts">
  import type { Route } from '../lib/gpx/route'

  interface Props {
    route: Route
    lat: number
    lon: number
  }

  let { route, lat, lon }: Props = $props()

  const BOX = 100
  const PAD = 6

  /**
   * Equirectangular, which is only wrong at scales far larger than a bike
   * ride. Longitude is scaled by cos(latitude) so the shape does not stretch
   * sideways the further from the equator you ride.
   */
  const projection = $derived.by(() => {
    const latitudes = route.points.map((p) => p.lat)
    const longitudes = route.points.map((p) => p.lon)
    const midLat = (Math.min(...latitudes) + Math.max(...latitudes)) / 2
    const squash = Math.cos((midLat * Math.PI) / 180)

    const minLon = Math.min(...longitudes)
    const minLat = Math.min(...latitudes)
    const width = (Math.max(...longitudes) - minLon) * squash
    const height = Math.max(...latitudes) - minLat
    // A dead-straight route has zero extent on one axis; keep the scale finite.
    const scale = (BOX - PAD * 2) / Math.max(width, height, 1e-9)

    // Centre whichever axis is the shorter one.
    const offsetX = (BOX - width * scale) / 2
    const offsetY = (BOX - height * scale) / 2

    return (pointLat: number, pointLon: number) => ({
      x: offsetX + (pointLon - minLon) * squash * scale,
      // SVG y grows downwards; north should be up.
      y: BOX - offsetY - (pointLat - minLat) * scale,
    })
  })

  const line = $derived(
    route.points
      .map((p) => {
        const { x, y } = projection(p.lat, p.lon)
        return `${x.toFixed(2)},${y.toFixed(2)}`
      })
      .join(' '),
  )

  const rider = $derived(projection(lat, lon))
</script>

<svg viewBox="0 0 {BOX} {BOX}" role="img" aria-label="Route overview">
  <polyline
    points={line}
    fill="none"
    stroke="var(--line)"
    stroke-width="2.5"
    stroke-linejoin="round"
    stroke-linecap="round"
    vector-effect="non-scaling-stroke"
  />
  <circle cx={rider.x} cy={rider.y} r="3" fill="var(--accent)" />
</svg>

<style>
  svg {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.25rem;
  }
</style>
