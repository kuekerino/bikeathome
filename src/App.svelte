<script lang="ts">
  import { onMount } from 'svelte'
  import { formatDistance, formatDuration, formatGradient, formatSpeed } from './lib/format'
  import type { Route } from './lib/gpx/route'
  import {
    engine,
    loadDemoRoute,
    loadRouteFromText,
    startSession,
    useSimulatedTrainer,
  } from './stores'

  let route = $state<Route | null>(null)
  let trainerLabel = $state<string | null>(null)
  let error = $state<string | null>(null)

  onMount(() => startSession())

  const ride = $derived($engine)
  const progress = $derived(ride.routeDistance > 0 ? ride.distance / ride.routeDistance : 0)

  const profile = $derived.by(() => {
    if (!route) return null
    const elevations = route.points.map((p) => p.ele)
    const low = Math.min(...elevations)
    const span = Math.max(1, Math.max(...elevations) - low)
    const points = route.points
      .map((p) => {
        const x = (p.distance / route!.totalDistance) * 1000
        const y = 100 - ((p.ele - low) / span) * 92
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' L')
    return { fill: `M0,100 L${points} L1000,100 Z`, low, span }
  })

  async function attempt(action: () => Promise<void> | void): Promise<void> {
    error = null
    try {
      await action()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
  }

  const useDemoRoute = () =>
    attempt(async () => {
      await loadDemoRoute()
      route = engine.currentRoute
    })

  const openFile = (event: Event) =>
    attempt(async () => {
      const file = (event.target as HTMLInputElement).files?.[0]
      if (!file) return
      loadRouteFromText(await file.text())
      route = engine.currentRoute
    })

  const connectSimulator = () =>
    attempt(async () => {
      trainerLabel = (await useSimulatedTrainer()).label
    })

  function gradientColour(gradient: number): string {
    if (gradient >= 8) return 'var(--bad)'
    if (gradient >= 4) return 'var(--warn)'
    if (gradient <= -3) return 'var(--accent-2)'
    return 'var(--good)'
  }
</script>

<main>
  <header>
    <div>
      <h1>bikeathome</h1>
      <p class="muted">{route ? (ride.routeName ?? 'Unnamed route') : 'No route loaded'}</p>
    </div>
    <div class="status muted">
      {#if trainerLabel}<span class="dot connected"></span>{trainerLabel}{:else}
        <span class="dot"></span>No trainer{/if}
    </div>
  </header>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  <section class="setup">
    <button onclick={useDemoRoute}>Load demo route</button>
    <label class="file">
      Open a GPX file
      <input type="file" accept=".gpx,application/gpx+xml" onchange={openFile} />
    </label>
    <button onclick={connectSimulator} disabled={trainerLabel !== null}>
      Connect demo trainer
    </button>
  </section>

  <section class="primary">
    <div class="stat big">
      <span class="value num" style:color={gradientColour(ride.routeGradient)}>
        {formatGradient(ride.routeGradient)}
      </span>
      <span class="label">Gradient</span>
    </div>
    <div class="stat big">
      <span class="value num">{Math.round(ride.powerW)}<small>W</small></span>
      <span class="label">Power</span>
    </div>
    <div class="stat big">
      <span class="value num">{ride.gear}<small>/24</small></span>
      <span class="label">Gear · {ride.gearRatio.toFixed(2)}</span>
    </div>
  </section>

  <section class="secondary">
    <div class="stat">
      <span class="value num">{formatSpeed(ride.speedMs)}</span><span class="label">km/h</span>
    </div>
    <div class="stat">
      <span class="value num">{Math.round(ride.cadenceRpm)}</span><span class="label">rpm</span>
    </div>
    <div class="stat">
      <span class="value num">{formatDistance(ride.distance)}</span>
      <span class="label">of {formatDistance(ride.routeDistance)} km</span>
    </div>
    <div class="stat">
      <span class="value num">{formatDuration(ride.elapsedSeconds)}</span>
      <span class="label">elapsed</span>
    </div>
    <div class="stat">
      <span class="value num">{Math.round(ride.climbed)}</span>
      <span class="label">of {Math.round(ride.routeAscent)} m climbed</span>
    </div>
    <div class="stat">
      <span class="value num">{formatGradient(ride.trainerGradient)}</span>
      <span class="label">at the trainer</span>
    </div>
  </section>

  {#if profile}
    <section class="profile">
      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" aria-label="Elevation profile">
        <path d={profile.fill} fill="var(--panel-2)" stroke="var(--line)" stroke-width="1" />
        <line
          x1={progress * 1000}
          x2={progress * 1000}
          y1="0"
          y2="100"
          stroke="var(--accent)"
          stroke-width="3"
          vector-effect="non-scaling-stroke"
        />
      </svg>
      <div class="axis muted">
        <span>{Math.round(profile.low)} m</span>
        <span>{Math.round(ride.elevation)} m here</span>
        <span>{Math.round(profile.low + profile.span)} m</span>
      </div>
    </section>
  {/if}

  <section class="controls">
    {#if ride.status === 'riding'}
      <button onclick={() => engine.pause()}>Pause</button>
    {:else if ride.status === 'paused'}
      <button onclick={() => engine.resume()}>Resume</button>
    {:else}
      <button onclick={() => engine.start()} disabled={route === null}>
        {ride.status === 'finished' ? 'Ride again' : 'Start ride'}
      </button>
    {/if}
    <button onclick={() => engine.end()} disabled={ride.status === 'idle'}>End</button>

    <span class="spacer"></span>

    <button onclick={() => engine.shift(-1)} title="Keyboard: minus">Easier</button>
    <button onclick={() => engine.shift(1)} title="Keyboard: plus">Harder</button>
  </section>

  <p class="muted hint">
    Status: {ride.status}. Shift with the + and − keys, or the arrows.
  </p>
</main>

<style>
  main {
    max-width: 68rem;
    margin: 0 auto;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gap);
  }

  h1 {
    margin: 0;
    font-size: 1.35rem;
    letter-spacing: -0.02em;
  }

  p {
    margin: 0;
  }

  .muted {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .status {
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--line);
  }

  .dot.connected {
    background: var(--good);
  }

  .error {
    background: color-mix(in srgb, var(--bad) 18%, transparent);
    border: 1px solid var(--bad);
    border-radius: var(--radius);
    padding: 0.6rem 0.8rem;
    font-size: 0.9rem;
  }

  .setup,
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .spacer {
    flex: 1;
  }

  .file {
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 8px 14px;
    cursor: pointer;
  }

  .file input {
    display: none;
  }

  .primary,
  .secondary {
    display: grid;
    gap: var(--gap);
  }

  .primary {
    grid-template-columns: repeat(3, 1fr);
  }

  .secondary {
    grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  }

  .stat {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.7rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }

  .stat .value {
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1.1;
  }

  .stat.big .value {
    font-size: 2.6rem;
  }

  .stat small {
    font-size: 0.9rem;
    font-weight: 400;
    color: var(--muted);
    margin-left: 0.15rem;
  }

  .stat .label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  .profile svg {
    display: block;
    width: 100%;
    height: 150px;
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  .axis {
    display: flex;
    justify-content: space-between;
    padding-top: 0.3rem;
  }

  .hint {
    font-size: 0.78rem;
  }

  @media (max-width: 40rem) {
    .primary {
      grid-template-columns: 1fr;
    }
  }
</style>
