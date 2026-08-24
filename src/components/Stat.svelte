<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    /** Rendered before the value. Decorative only — the label still speaks. */
    icon?: Snippet
    value: string | number
    label: string
    unit?: string
    /** Overrides the value colour, e.g. to band a gradient by steepness. */
    colour?: string
    size?: 'normal' | 'large'
  }

  let { value, label, unit, colour, size = 'normal', icon }: Props = $props()

  /**
   * Read as one phrase. Left to itself a screen reader announces the number and
   * the label as two unrelated fragments, and "183" on its own means nothing.
   */
  const spoken = $derived(`${label}: ${value}${unit ? ` ${unit}` : ''}`)
</script>

<div class="stat" class:large={size === 'large'} role="group" aria-label={spoken}>
  <span class="value num" style:color={colour} aria-hidden="true">
    {#if icon}<span class="icon">{@render icon()}</span>{/if}{value}{#if unit}<small>{unit}</small
      >{/if}
  </span>
  <span class="label" aria-hidden="true">{label}</span>
</div>

<style>
  .icon {
    margin-right: 0.3em;
  }

  .stat {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.7rem 0.9rem;
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 0;
  }

  .value {
    font-size: 1.5rem;
    font-weight: 600;
    line-height: 1.1;
    white-space: nowrap;
  }

  .large .value {
    font-size: 2.6rem;
  }

  small {
    font-size: 0.85rem;
    font-weight: 400;
    color: var(--muted);
    margin-left: 0.12rem;
  }

  .label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
