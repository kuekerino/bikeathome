<script lang="ts">
  /**
   * Manual watt mode: tell the trainer to hold a number and pedal against it.
   *
   * Deliberately not a text field as the primary control. Setting an effort
   * mid-interval, out of the saddle, with sweat on your hands, is a job for
   * big buttons — so the steps are the interface and the number is a readout
   * you can still type into if you want to.
   */
  import type { HeartRateCapSettings } from '../lib/ride/heartRateCap'

  interface Props {
    /** Watts the rider asked for, or null when the gradient is in charge. */
    target: number | null
    /** Watts actually being sent — below target when the ceiling pulled it down. */
    held: number | null
    /** What the rider is actually producing right now. */
    actual: number
    heartRateBpm: number | null
    overCeiling: boolean
    cap: HeartRateCapSettings
    disabled: boolean
    onSet: (watts: number | null) => void
    onNudge: (delta: number) => void
    onCapChange: (cap: HeartRateCapSettings) => void
  }

  let {
    target,
    held,
    actual,
    heartRateBpm,
    overCeiling,
    cap,
    disabled,
    onSet,
    onNudge,
    onCapChange,
  }: Props = $props()

  /** The ceiling is actively taking watts away, not merely set. */
  const holdingBack = $derived(target !== null && held !== null && held < target)

  const STEPS = [50, 10, 1] as const

  const engaged = $derived(target !== null)

  function toggle(): void {
    // Starting from what the rider is already doing beats starting from a
    // round number they then have to walk down to.
    onSet(engaged ? null : Math.max(50, Math.round(actual || 150)))
  }
</script>

<section class:engaged>
  <header>
    <label class="switch">
      <input type="checkbox" checked={engaged} onchange={toggle} {disabled} />
      <span>
        <strong>Hold a set power</strong>
        <em>
          {engaged
            ? 'The trainer holds this whatever gear or cadence you are in, so shifting changes your cadence, not your effort. Speed still follows the route.'
            : 'Resistance follows the gradient, and the gear decides how hard that feels.'}
        </em>
      </span>
    </label>
  </header>

  {#if engaged}
    <div class="dial">
      <div class="steps">
        {#each STEPS as step (step)}
          <button onclick={() => onNudge(-step)} {disabled} aria-label={`${step} watts less`}>
            −{step}
          </button>
        {/each}
      </div>

      <label class="readout">
        <input
          type="number"
          min="0"
          max="2000"
          step="5"
          value={target}
          onchange={(e) => onSet(Number(e.currentTarget.value))}
          {disabled}
        />
        <span>W</span>
      </label>

      <div class="steps">
        {#each [...STEPS].reverse() as step (step)}
          <button onclick={() => onNudge(step)} {disabled} aria-label={`${step} watts more`}>
            +{step}
          </button>
        {/each}
      </div>
    </div>

    <p class="hint">
      Now: <strong>{Math.round(actual)} W</strong>
      {#if target !== null && actual > 0}
        <span class="drift">({actual > target ? '+' : ''}{Math.round(actual - target)})</span>
      {/if}
    </p>

    <div class="ceiling" class:over={overCeiling}>
      <label>
        <span>Never above</span>
        <span class="field">
          <input
            type="number"
            min="80"
            max="220"
            step="1"
            placeholder="—"
            value={cap.ceilingBpm}
            onchange={(e) => {
              const raw = Number(e.currentTarget.value)
              onCapChange({ ...cap, ceilingBpm: Number.isFinite(raw) && raw > 0 ? raw : null })
            }}
          />
          <span class="unit">bpm</span>
        </span>
      </label>

      {#if cap.ceilingBpm !== null}
        <label class="inline">
          <input
            type="checkbox"
            checked={cap.autoBackOff}
            onchange={(e) => onCapChange({ ...cap, autoBackOff: e.currentTarget.checked })}
          />
          <span>Ease the watts off automatically</span>
        </label>

        <p class="hint">
          {#if heartRateBpm === null}
            No strap connected, so nothing is watching.
          {:else if holdingBack}
            <strong>{heartRateBpm} bpm</strong> — holding {held} W instead of {target} W.
          {:else if overCeiling}
            <strong>{heartRateBpm} bpm</strong> — over the ceiling.
          {:else}
            <strong>{heartRateBpm} bpm</strong> — under the ceiling.
          {/if}
        </p>
      {:else}
        <p class="hint">
          The same watts cost a different heart rate on a hot day or on tired legs. Set a
          ceiling and an endurance ride stays an endurance ride.
        </p>
      {/if}
    </div>
  {/if}
</section>

<style>
  section {
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    padding: 0.75rem 0.9rem;
    background: var(--panel);
  }

  section.engaged {
    border-color: var(--accent);
  }

  .switch {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    cursor: pointer;
    font-size: 0.88rem;
  }

  .switch span {
    display: flex;
    flex-direction: column;
  }

  .switch em {
    font-style: normal;
    font-size: 0.78rem;
    color: var(--muted);
  }

  .switch input {
    margin-top: 0.25rem;
    accent-color: var(--accent);
  }

  .dial {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin-top: 0.85rem;
    flex-wrap: wrap;
  }

  .steps {
    display: flex;
    gap: 0.3rem;
  }

  .steps button {
    min-width: 3rem;
    padding: 0.55rem 0.35rem;
    font-variant-numeric: tabular-nums;
  }

  .readout {
    display: flex;
    align-items: baseline;
    gap: 0.25rem;
  }

  .readout input {
    width: 5.5rem;
    font-size: 1.6rem;
    font-variant-numeric: tabular-nums;
    text-align: center;
    padding: 0.15rem 0.25rem;
  }

  .readout span {
    color: var(--muted);
    font-size: 0.9rem;
  }

  .hint {
    margin: 0.6rem 0 0;
    text-align: center;
    font-size: 0.82rem;
    color: var(--muted);
  }

  .drift {
    font-variant-numeric: tabular-nums;
  }

  .ceiling {
    margin-top: 0.85rem;
    padding-top: 0.75rem;
    border-top: 1px solid var(--line);
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .ceiling.over strong {
    color: var(--danger, #e5534b);
  }

  .ceiling label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.88rem;
  }

  .ceiling .inline {
    justify-content: flex-start;
    gap: 0.5rem;
    cursor: pointer;
  }

  .ceiling .inline input {
    accent-color: var(--accent);
  }

  .field {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .field input {
    width: 5rem;
    font-size: 1rem;
    text-align: right;
  }

  .unit {
    font-size: 0.78rem;
    color: var(--muted);
  }

  .ceiling .hint {
    text-align: left;
  }
</style>
