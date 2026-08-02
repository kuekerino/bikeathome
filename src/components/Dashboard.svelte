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
  import Stat from './Stat.svelte'

  interface Props {
    ride: RideSnapshot
    virtualShifting: boolean
  }

  let { ride, virtualShifting }: Props = $props()
</script>

<div class="primary">
  <Stat
    size="large"
    value={formatGradient(ride.routeGradient)}
    label="Gradient"
    colour={gradientColour(ride.routeGradient)}
  />
  <Stat size="large" value={Math.round(ride.powerW)} unit="W" label="Power" />
  <GearIndicator
    gear={ride.gear}
    ratio={ride.gearRatio}
    relativeRatio={ride.relativeRatio}
    virtual={virtualShifting}
  />
</div>

<div class="secondary">
  <Stat value={formatSpeed(ride.speedMs)} label="km/h" />
  <Stat value={Math.round(ride.cadenceRpm)} label="rpm" />
  <Stat
    value={formatDistance(ride.distance)}
    label="of {formatDistance(ride.routeDistance)} km"
  />
  <Stat value={formatDuration(ride.elapsedSeconds)} label="elapsed" />
  <Stat
    value={Math.round(ride.climbed)}
    label="of {Math.round(ride.routeAscent)} m climbed"
  />
  <Stat
    value={formatGradient(ride.trainerGradient)}
    label={virtualShifting ? 'at the trainer' : 'at the trainer (no gearing)'}
    colour={gradientColour(ride.trainerGradient)}
  />
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
