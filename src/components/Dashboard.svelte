<script lang="ts">
  import {
    formatDistance,
    formatDuration,
    formatGradient,
    formatSpeed,
    gradientColour,
  } from '../lib/format'
  import type { RideSnapshot } from '../lib/ride/engine'
  import GearIndicator from './GearIndicator.svelte'
  import HeartBeat from './HeartBeat.svelte'
  import Stat from './Stat.svelte'

  interface Props {
    ride: RideSnapshot
    virtualShifting: boolean
  }

  let { ride, virtualShifting }: Props = $props()

  // With no route there is no gradient, no elevation and nothing to be a
  // fraction of, so those stats would read as zeroes rather than as absent.
  const free = $derived(ride.mode === 'free')
  /** While the trainer holds a power, the gear and the gradient decide nothing. */
  const holdingPower = $derived(ride.targetPowerW !== null)
</script>

<div class="primary">
  {#if free}
    <Stat
      size="large"
      value={ride.targetPowerW ?? '—'}
      unit={ride.targetPowerW === null ? undefined : 'W'}
      label="Target"
    />
  {:else}
    <Stat
      size="large"
      value={formatGradient(ride.routeGradient)}
      label="Gradient"
      colour={gradientColour(ride.routeGradient)}
    />
  {/if}
  <Stat size="large" value={Math.round(ride.powerW)} unit="W" label="Power" />
  <GearIndicator
    gear={ride.gear}
    ratio={ride.gearRatio}
    relativeRatio={ride.relativeRatio}
    virtual={virtualShifting}
    inert={holdingPower}
  />
</div>

<div class="secondary">
  <Stat value={formatSpeed(ride.speedMs)} label="km/h" />
  <Stat value={Math.round(ride.cadenceRpm)} label="rpm" />
  {#if ride.heartRateBpm !== null}
    {#snippet heart()}
      <HeartBeat bpm={ride.heartRateBpm ?? 60} />
    {/snippet}
    <Stat
      value={ride.heartRateBpm}
      label={ride.overCeiling ? 'bpm — over the ceiling' : 'bpm'}
      colour={ride.overCeiling ? 'var(--bad)' : undefined}
      icon={heart}
    />
  {/if}
  {#if free}
    <Stat value={formatDistance(ride.distance)} label="km" />
  {:else}
    <Stat
      value={formatDistance(ride.distance)}
      label="of {formatDistance(ride.routeDistance)} km"
    />
  {/if}
  <Stat value={formatDuration(ride.elapsedSeconds)} label="elapsed" />
  {#if !free}
    <Stat value={Math.round(ride.climbed)} label="of {Math.round(ride.routeAscent)} m climbed" />
  {/if}
  {#if holdingPower}
    <Stat
      value={ride.heldPowerW ?? 0}
      label={ride.heldPowerW !== ride.targetPowerW
        ? `W held — eased off from ${ride.targetPowerW}`
        : 'W held at the trainer'}
    />
  {:else}
    <Stat
      value={formatGradient(ride.trainerGradient)}
      label={virtualShifting ? 'at the trainer' : 'at the trainer (no gearing)'}
      colour={gradientColour(ride.trainerGradient)}
    />
  {/if}
</div>

<style>
  .primary,
  .secondary {
    display: grid;
    gap: var(--gap);
  }

  .primary {
    grid-template-columns: repeat(3, 1fr);
    margin-bottom: var(--gap);
  }

  .secondary {
    grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr));
  }

  @media (max-width: 46rem) {
    .primary {
      grid-template-columns: 1fr;
    }
  }
</style>
