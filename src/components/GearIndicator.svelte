<script lang="ts">
  import { GEAR_COUNT } from '../lib/physics/gears'

  interface Props {
    gear: number
    ratio: number
    /** How much harder than the bike's own drivetrain the current gear is. */
    relativeRatio: number
    virtual: boolean
    /**
     * The trainer is holding a fixed power, so the gear no longer decides
     * anything about the effort. Saying so beats showing a live-looking gear
     * that does nothing.
     */
    inert?: boolean
  }

  let { gear, ratio, relativeRatio, virtual, inert = false }: Props = $props()

  const gears = Array.from({ length: GEAR_COUNT }, (_, i) => i + 1)
</script>

<div class="gear" class:inert>
  {#if virtual}
    <div class="readout">
      <span class="value num">{gear}<small>/{GEAR_COUNT}</small></span>
      <span class="ratio num">
        {#if inert}
          not in use
        {:else}
          {ratio.toFixed(2)} · {relativeRatio.toFixed(2)}×
        {/if}
      </span>
    </div>
    <div class="ladder" aria-hidden="true">
      {#each gears as index (index)}
        <span class="rung" class:on={index <= gear} class:current={index === gear}></span>
      {/each}
    </div>
    <span class="label">{inert ? 'Gear · holding power' : 'Gear'}</span>
  {:else}
    <div class="readout">
      <span class="value">Cassette</span>
      <span class="ratio">Shift on the bike</span>
    </div>
    <span class="label">Drivetrain</span>
  {/if}
</div>

<style>
  .inert .ladder,
  .inert .value {
    opacity: 0.4;
  }

  .gear {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.7rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .readout {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .value {
    font-size: 2.6rem;
    font-weight: 600;
    line-height: 1;
  }

  small {
    font-size: 0.85rem;
    font-weight: 400;
    color: var(--muted);
  }

  .ratio {
    font-size: 0.78rem;
    color: var(--muted);
  }

  .ladder {
    display: flex;
    gap: 2px;
    height: 14px;
    align-items: flex-end;
  }

  .rung {
    flex: 1;
    height: 40%;
    border-radius: 1px;
    background: var(--line);
    transition: height 120ms ease, background-color 120ms ease;
  }

  .rung.on {
    background: var(--accent-2);
    height: 70%;
  }

  .rung.current {
    background: var(--accent);
    height: 100%;
  }

  .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
</style>
