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
</script>

<ul>
  {#each devices as device (device.what)}
    <li>
      <span class="dot {device.state}" aria-hidden="true"></span>
      <span class="what">{device.what}</span>
      <span class="label">{device.state === 'connected' ? device.label : wording[device.state]}</span>
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
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.8rem;
    background: var(--panel);
    font-size: 0.88rem;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--muted);
    flex: none;
  }

  .dot.connected {
    background: var(--good);
  }

  .dot.connecting {
    background: var(--warn);
  }

  .dot.error {
    background: var(--bad);
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
