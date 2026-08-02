<script lang="ts">
  import { onMount } from 'svelte'
  import ConnectPanel, { type DeviceRow } from './components/ConnectPanel.svelte'
  import Dashboard from './components/Dashboard.svelte'
  import ElevationProfile from './components/ElevationProfile.svelte'
  import RideControls from './components/RideControls.svelte'
  import RouteLoader from './components/RouteLoader.svelte'
  import RouteMap from './components/RouteMap.svelte'
  import SettingsPanel from './components/SettingsPanel.svelte'
  import type { Route } from './lib/gpx/route'
  import { loadSettings, type AppSettings } from './lib/settings'
  import {
    applySettings,
    engine,
    exportRide,
    keyboardShifter,
    loadDemoRoute,
    loadRouteFromText,
    startRide,
    startSession,
    useSimulatedTrainer,
  } from './stores'

  let route = $state<Route | null>(null)
  let settings = $state<AppSettings>(loadSettings())
  let trainerLabel = $state<string | null>(null)
  let error = $state<string | null>(null)
  let busy = $state(false)

  onMount(() => startSession())

  const ride = $derived($engine)
  const virtualShifting = $derived(settings.drivetrain.mode === 'virtual')
  const riding = $derived(ride.status === 'riding' || ride.status === 'paused')

  const devices = $derived<DeviceRow[]>([
    {
      what: 'Trainer',
      label: trainerLabel ?? '',
      state: trainerLabel ? 'connected' : 'disconnected',
      detail: trainerLabel ? `${Math.round(ride.powerW)} W` : undefined,
      connect: () => void connectSimulator(),
    },
    {
      what: 'Shifter',
      label: keyboardShifter.label,
      state: 'connected',
      detail: virtualShifting ? `gear ${ride.gear}` : 'not needed',
    },
  ])

  async function attempt(action: () => Promise<void> | void): Promise<void> {
    error = null
    busy = true
    try {
      await action()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }

  const openDemoRoute = () =>
    attempt(async () => {
      await loadDemoRoute()
      route = engine.currentRoute
    })

  const openFile = (text: string) =>
    void attempt(() => {
      loadRouteFromText(text)
      route = engine.currentRoute
    })

  const connectSimulator = () =>
    attempt(async () => {
      trainerLabel = (await useSimulatedTrainer()).label
    })

  function updateSettings(next: AppSettings): void {
    settings = next
    applySettings(next)
  }
</script>

<main>
  <header>
    <div>
      <h1>bikeathome</h1>
      <p class="sub">
        {#if route}
          {ride.routeName ?? 'Unnamed route'}
        {:else}
          Ride your own GPX routes on a smart trainer
        {/if}
      </p>
    </div>
    {#if route && !riding}
      <button class="ghost" onclick={() => (route = null)}>Change route</button>
    {/if}
  </header>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  {#if !route}
    <RouteLoader onFile={openFile} onDemo={openDemoRoute} {busy} />
  {/if}

  <ConnectPanel {devices} />

  {#if route}
    <Dashboard {ride} {virtualShifting} />

    <div class="visuals">
      <ElevationProfile {route} distance={ride.distance} />
      <RouteMap {route} lat={ride.lat} lon={ride.lon} />
    </div>

    <RideControls
      status={ride.status}
      canStart={route !== null}
      canShift={virtualShifting}
      canExport={ride.elapsedSeconds >= 1}
      onStart={startRide}
      onPause={() => engine.pause()}
      onResume={() => engine.resume()}
      onEnd={() => engine.end()}
      onShift={(direction) => engine.shift(direction)}
      onExport={() => void attempt(exportRide)}
    />
  {/if}

  <SettingsPanel {settings} onChange={updateSettings} />

  <footer>
    {#if virtualShifting}
      Shift with <kbd>+</kbd> and <kbd>−</kbd>, or the arrow keys.
    {:else}
      Cassette mode: shift on the bike. The trainer gets the route gradient unchanged.
    {/if}
  </footer>
</main>

<style>
  main {
    max-width: 72rem;
    margin: 0 auto;
    padding: 1.25rem;
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
    font-size: 1.3rem;
    letter-spacing: -0.02em;
  }

  .sub {
    margin: 0.1rem 0 0;
    color: var(--muted);
    font-size: 0.85rem;
  }

  .ghost {
    background: transparent;
    font-size: 0.85rem;
    padding: 5px 10px;
  }

  .error {
    margin: 0;
    background: color-mix(in srgb, var(--bad) 16%, transparent);
    border: 1px solid var(--bad);
    border-radius: var(--radius);
    padding: 0.6rem 0.8rem;
    font-size: 0.88rem;
  }

  .visuals {
    display: grid;
    grid-template-columns: 1fr 200px;
    gap: var(--gap);
    align-items: start;
  }

  footer {
    color: var(--muted);
    font-size: 0.78rem;
  }

  kbd {
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-bottom-width: 2px;
    border-radius: 4px;
    padding: 0 5px;
    font-family: inherit;
    font-size: 0.9em;
  }

  @media (max-width: 46rem) {
    .visuals {
      grid-template-columns: 1fr;
    }
  }
</style>
