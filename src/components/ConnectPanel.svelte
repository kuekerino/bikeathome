<script lang="ts">
  import type { ConnectionState } from '../lib/ble/types'

  export interface DeviceAction {
    label: string
    run: () => void
  }

  export interface DeviceRow {
    label: string
    what: string
    state: ConnectionState
    detail?: string
    actions?: DeviceAction[]
  }

  interface Props {
    devices: DeviceRow[]
    /** Shown once, when the browser cannot pair anything at all. */
    note?: string
  }

  let { devices, note }: Props = $props()

  const wording: Record<ConnectionState, string> = {
    disconnected: 'Not connected',
    connecting: 'Connecting…',
    connected: 'Connected',
    error: 'Failed',
  }

  /**
   * Shape as well as colour. Green against grey at eight pixels is the whole
   * state indicator otherwise, which is no indicator at all to a rider who
   * cannot separate the two — and a filled circle against a hollow one is
   * legible even when both look identical in hue.
   */
  const glyph: Record<ConnectionState, string> = {
    disconnected: '○',
    connecting: '◐',
    connected: '●',
    error: '▲',
  }
</script>

<ul>
  {#each devices as device (device.what)}
    <li>
      <span class="dot {device.state}" aria-hidden="true">{glyph[device.state]}</span>
      <span class="what">{device.what}</span>
      <span class="label">
        {#if device.state === 'connected'}
          <!-- The visible text is the device's name, which does not itself say
               the thing is connected. Spoken, that has to be explicit. -->
          <span class="visually-hidden">Connected:</span>
          {device.label}
        {:else}
          {wording[device.state]}
        {/if}
      </span>
      {#if device.detail}<span class="detail">{device.detail}</span>{/if}
      {#if device.actions?.length}
        <span class="actions">
          {#each device.actions as action (action.label)}
            <button onclick={action.run} disabled={device.state === 'connecting'}>
              {action.label}
            </button>
          {/each}
        </span>
      {/if}
    </li>
  {/each}
  {#if note}
    <li class="note">{note}</li>
  {/if}
</ul>

<style>
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--line);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    overflow: hidden;
  }

  li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.8rem;
    background: var(--panel);
    font-size: 0.88rem;
  }

  .dot {
    width: 1em;
    font-size: 0.85rem;
    line-height: 1;
    text-align: center;
    color: var(--muted);
    flex: none;
  }

  .dot.connected {
    color: var(--good);
  }

  .dot.connecting {
    color: var(--warn);
  }

  .dot.error {
    color: var(--bad);
  }

  .what {
    font-weight: 600;
    min-width: 5.5rem;
  }

  .label,
  .detail {
    color: var(--muted);
  }

  .detail {
    font-variant-numeric: tabular-nums;
  }

  .actions {
    margin-left: auto;
    display: flex;
    gap: 0.4rem;
  }

  button {
    padding: 4px 12px;
    font-size: 0.85rem;
  }

  .note {
    color: var(--muted);
    font-size: 0.8rem;
    line-height: 1.45;
  }
</style>
