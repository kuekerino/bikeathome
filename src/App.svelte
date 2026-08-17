<script lang="ts">
  import { onMount } from 'svelte'
  import type { ConnectionState } from './lib/ble/types'
  import ConnectPanel, { type DeviceRow } from './components/ConnectPanel.svelte'
  import ControlsPanel from './components/ControlsPanel.svelte'
  import Dashboard from './components/Dashboard.svelte'
  import ElevationProfile from './components/ElevationProfile.svelte'
  import PowerPanel from './components/PowerPanel.svelte'
  import RideControls from './components/RideControls.svelte'
  import RouteLoader from './components/RouteLoader.svelte'
  import RouteMap from './components/RouteMap.svelte'
  import SettingsPanel from './components/SettingsPanel.svelte'
  import WorkoutPanel from './components/WorkoutPanel.svelte'
  import { bluetoothNote, currentPlatform } from './lib/browserSupport'
  import type { Route } from './lib/gpx/route'
  import { loadSettings, type AppSettings } from './lib/settings'
  import { keepScreenAwake } from './lib/wakeLock'
  import {
    applySettings,
    bluetoothAvailable,
    engine,
    exportRide,
    loadDemoRoute,
    loadRouteFromText,
    parseWorkout,
    setWorkout,
    clearWorkout,
    heartRate,
    pairHeartRate,
    pairShifter,
    pairTrainer,
    resumePairings,
    startFreeRide,
    startRide,
    startSession,
    useSimulatedTrainer,
    zwiftClick,
  } from './stores'

  let route = $state<Route | null>(null)
  let settings = $state<AppSettings>(loadSettings())
  let error = $state<string | null>(null)
  let busy = $state(false)
  /** Pedalling with no route: flat, endless, watts only. */
  let freeRide = $state(false)

  let trainerLabel = $state<string | null>(null)
  let trainerState = $state<ConnectionState>('disconnected')
  let clickState = $state<ConnectionState>('disconnected')
  let clickBattery = $state<number | null>(null)
  let strapState = $state<ConnectionState>('disconnected')
  let strapLabel = $state<string | null>(null)
  let strapBattery = $state<number | null>(null)
  let strapNotFound = $state(false)
  /** Set once a pairing attempt came back empty, to reveal the wider search. */
  let trainerNotFound = $state(false)
  let clickNotFound = $state(false)

  const bluetooth = bluetoothAvailable()

  onMount(() => {
    const stop = startSession()

    zwiftClick.onstate = (state, detail) => {
      clickState = state
      if (state === 'error' && detail) error = detail
    }
    zwiftClick.onbattery = (percent) => (clickBattery = percent)

    heartRate.onstate = (state, detail) => {
      strapState = state
      if (state === 'error' && detail) error = detail
    }
    heartRate.onbattery = (percent) => (strapBattery = percent)

    // Devices this browser already has permission for come back on their own.
    // Deliberately not awaited: the page is usable while it tries, and every
    // failure is silent, so there is nothing to wait for.
    void resumePairings().then(({ trainer, heartRate: strap }) => {
      clickState = zwiftClick.state
      strapState = heartRate.state
      if (strap) strapLabel = strap.label
      if (!trainer) return
      trainerLabel = trainer.label
      trainerState = trainer.state
      trainer.onstate = (state, detail) => {
        trainerState = state
        if (state === 'error' && detail) error = detail
      }
    })

    return stop
  })

  const ride = $derived($engine)
  const virtualShifting = $derived(settings.drivetrain.mode === 'virtual')
  const riding = $derived(ride.status === 'riding' || ride.status === 'paused')
  /** A route loaded, or free ride chosen. Either way there is a ride on screen. */
  const chosen = $derived(route !== null || freeRide)
  const onRoute = $derived(route !== null)

  $effect(() => keepScreenAwake(ride.status === 'riding'))

  const devices = $derived<DeviceRow[]>([
    {
      what: 'Trainer',
      label: trainerLabel ?? '',
      state: trainerState,
      detail: trainerState === 'connected' ? `${Math.round(ride.powerW)} W` : undefined,
      actions:
        trainerState === 'connected'
          ? []
          : [
              ...(bluetooth ? [{ label: 'Pair trainer', run: () => void connectTrainer() }] : []),
              ...(bluetooth && trainerNotFound
                ? [{ label: 'Show all devices', run: () => void connectTrainer(true) }]
                : []),
              { label: 'Use demo trainer', run: () => void connectSimulator() },
            ],
    },
    {
      // The keyboard is always live, so the shifter row is never truly
      // disconnected — a paired Click is an upgrade, not a prerequisite.
      what: 'Shifter',
      label: clickState === 'connected' ? zwiftClick.label : 'Keyboard',
      state: 'connected',
      detail: clickBattery !== null ? `${clickBattery}%` : virtualShifting ? `gear ${ride.gear}` : 'not needed',
      actions:
        bluetooth && virtualShifting && clickState !== 'connected'
          ? [
              { label: 'Pair Zwift Click', run: () => void connectClick() },
              ...(clickNotFound
                ? [{ label: 'Show all devices', run: () => void connectClick(true) }]
                : []),
            ]
          : [],
    },
    {
      what: 'Heart rate',
      label: strapState === 'connected' ? (strapLabel ?? heartRate.label) : '',
      state: strapState,
      detail:
        ride.heartRateBpm !== null
          ? `${ride.heartRateBpm} bpm${strapBattery === null ? '' : ` · ${strapBattery}%`}`
          : undefined,
      actions:
        bluetooth && strapState !== 'connected'
          ? [
              { label: 'Pair strap', run: () => void connectStrap() },
              ...(strapNotFound
                ? [{ label: 'Show all devices', run: () => void connectStrap(true) }]
                : []),
            ]
          : [],
    },
  ])

  const browserNote = bluetoothNote(currentPlatform())

  /** @returns whether the action got through, so callers can offer a way out. */
  async function attempt(action: () => Promise<void> | void): Promise<boolean> {
    error = null
    busy = true
    try {
      await action()
      return true
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
      return false
    } finally {
      busy = false
    }
  }

  const openDemoRoute = () =>
    attempt(async () => {
      await loadDemoRoute()
      route = engine.currentRoute
      freeRide = false
    })

  const openFile = (text: string) =>
    void attempt(() => {
      loadRouteFromText(text)
      route = engine.currentRoute
      freeRide = false
    })

  /**
   * A workout is a way to start a ride, not something added to one. Loading it
   * with nothing else chosen puts the rider on a flat road — the session
   * decides the effort, so there is nothing else to pick.
   */
  const openWorkout = (xml: string) =>
    void attempt(() => {
      // Parse before committing to anything: a file that will not load should
      // leave the screen exactly as it was.
      const workout = parseWorkout(xml)
      if (!chosen) openFreeRide()
      setWorkout(workout)
    })

  function openFreeRide(): void {
    startFreeRide()
    route = null
    freeRide = true
  }

  function chooseAgain(): void {
    route = null
    freeRide = false
  }

  const connectSimulator = () =>
    attempt(async () => {
      trainerLabel = (await useSimulatedTrainer()).label
      trainerState = 'connected'
    })

  async function connectTrainer(showEverything = false): Promise<void> {
    const paired = await attempt(async () => {
      const trainer = await pairTrainer(showEverything)
      trainerLabel = trainer.label
      trainerState = trainer.state
      trainer.onstate = (state, detail) => {
        trainerState = state
        if (state === 'error' && detail) error = detail
      }
    })
    // An empty chooser and a cancelled one are the same failure to the page, so
    // offer the wider search after either. It costs a button nobody has to press.
    if (!paired) trainerNotFound = true
  }

  async function connectClick(showEverything = false): Promise<void> {
    const paired = await attempt(async () => {
      await pairShifter(showEverything)
      clickState = zwiftClick.state
    })
    if (!paired) clickNotFound = true
  }

  async function connectStrap(showEverything = false): Promise<void> {
    const paired = await attempt(async () => {
      strapLabel = (await pairHeartRate(showEverything)).label
      strapState = heartRate.state
    })
    if (!paired) strapNotFound = true
  }

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
        {#if onRoute}
          {ride.routeName ?? 'Unnamed route'}
        {:else if freeRide}
          Just pedalling — no route
        {:else}
          Ride your own GPX routes on a smart trainer
        {/if}
      </p>
    </div>
    {#if chosen && !riding}
      <button class="ghost" onclick={chooseAgain}>Change</button>
    {/if}
  </header>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {/if}

  {#if !chosen}
    <RouteLoader onFile={openFile} onDemo={openDemoRoute} onFree={openFreeRide} {busy} />
  {/if}

{#snippet workoutPanel()}
    <WorkoutPanel
      progress={ride.workout}
      ftpW={settings.ftpW}
      onLoad={openWorkout}
      onClear={clearWorkout}
      onSkip={(direction) => engine.skipStep(direction)}
      onFtp={(ftpW) => updateSettings({ ...settings, ftpW })}
    />
  {/snippet}

  <!-- Before a ride it is a third way in, beside the GPX drop and Just pedal.
       During one it belongs with the other things being ridden against. -->
  {#if !chosen}
    {@render workoutPanel()}
  {/if}

  <ConnectPanel {devices} note={browserNote} />

  {#if chosen}
    <Dashboard {ride} {virtualShifting} />

    {#if route}
      <div class="visuals">
        <ElevationProfile {route} distance={ride.distance} />
        <RouteMap {route} lat={ride.lat} lon={ride.lon} />
      </div>
    {/if}

    <RideControls
      status={ride.status}
      canStart={chosen}
      canShift={virtualShifting}
      canExport={ride.elapsedSeconds >= 1}
      onStart={startRide}
      onPause={() => engine.pause()}
      onResume={() => engine.resume()}
      onEnd={() => engine.end()}
      onShift={(direction) => engine.shift(direction)}
      onExport={() => void attempt(exportRide)}
    />

    {@render workoutPanel()}

    <PowerPanel
      target={ride.targetPowerW}
      held={ride.heldPowerW}
      actual={ride.powerW}
      heartRateBpm={ride.heartRateBpm}
      overCeiling={ride.overCeiling}
      cap={settings.heartRateCap}
      disabled={trainerState !== 'connected'}
      onSet={(watts) => engine.setTargetPower(watts)}
      onNudge={(delta) => engine.nudgeTargetPower(delta)}
      onCapChange={(heartRateCap) => updateSettings({ ...settings, heartRateCap })}
    />
  {/if}

  <SettingsPanel {settings} onChange={updateSettings} />

  <ControlsPanel
    bindings={settings.bindings}
    seenButtons={ride.seenButtons}
    onChange={(bindings) => updateSettings({ ...settings, bindings })}
  />

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
