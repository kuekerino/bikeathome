<script lang="ts">
  import type { ConnectionState } from '../lib/ble/types'

  export interface DeviceRow {
    label: string
    what: string
    state: ConnectionState
    detail?: string
    /** Absent while a device cannot be paired yet. */
    connect?: () => void
  }

  interface Props {
    devices: DeviceRow[]
  }

  let { devices }: Props = $props()

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
      {#if device.connect && device.state !== 'connected'}
        <button onclick={device.connect} disabled={device.state === 'connecting'}>Connect</button>
      {/if}
    </li>
  {/each}
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

  button {
    margin-left: auto;
    padding: 4px 12px;
    font-size: 0.85rem;
  }
</style>
