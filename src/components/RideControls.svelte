<script lang="ts">
  import type { RideStatus } from '../lib/ride/engine'

  interface Props {
    status: RideStatus
    canStart: boolean
    canShift: boolean
    canExport: boolean
    onStart: () => void
    onPause: () => void
    onResume: () => void
    onEnd: () => void
    onShift: (direction: 1 | -1) => void
    onExport: () => void
  }

  let {
    status,
    canStart,
    canShift,
    canExport,
    onStart,
    onPause,
    onResume,
    onEnd,
    onShift,
    onExport,
  }: Props = $props()
</script>

<div class="controls">
  {#if status === 'riding'}
    <button class="primary" onclick={onPause}>Pause</button>
  {:else if status === 'paused'}
    <button class="primary" onclick={onResume}>Resume</button>
  {:else}
    <button class="primary" onclick={onStart} disabled={!canStart}>
      {status === 'finished' ? 'Ride again' : 'Start ride'}
    </button>
  {/if}

  <button onclick={onEnd} disabled={status !== 'riding' && status !== 'paused'}>End ride</button>

  <button onclick={onExport} disabled={!canExport} title="Download this ride as a TCX file">
    Export
  </button>

  <span class="spacer"></span>

  <div class="shift">
    <button onclick={() => onShift(-1)} disabled={!canShift} title="Keyboard: minus or down">
      − Easier
    </button>
    <button onclick={() => onShift(1)} disabled={!canShift} title="Keyboard: plus or up">
      Harder +
    </button>
  </div>
</div>

<style>
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .spacer {
    flex: 1;
  }

  .shift {
    display: flex;
    gap: 0.5rem;
  }

  .primary {
    background: var(--accent);
    color: #1a1300;
    border-color: transparent;
    font-weight: 600;
  }

  .primary:hover:not(:disabled) {
    filter: brightness(1.08);
  }
</style>
