<script lang="ts">
  /**
   * Past rides. Saved automatically, kept in this browser, never uploaded.
   */
  import { formatLength, formatWhen, type RideSummary } from '../lib/history/summary'

  interface Props {
    rides: readonly RideSummary[]
    /** Null when the browser will not say, which some will not. */
    storage: { usedMb: number; quotaMb: number } | null
    busy: boolean
    onExport: (ride: RideSummary) => void
    onRepeat: (ride: RideSummary) => void
    onDelete: (ride: RideSummary) => void
    onClear: () => void
    onRefresh: () => void
  }

  let { rides, storage, busy, onExport, onRepeat, onDelete, onClear, onRefresh }: Props = $props()

  let confirming = $state(false)
</script>

<!-- `ontoggle`, not a click handler: opening a disclosure with the keyboard
     fires no click, and the list would then never load for anyone using one. -->
<details ontoggle={(e) => e.currentTarget.open && onRefresh()}>
  <summary>Past rides {rides.length > 0 ? `(${rides.length})` : ''}</summary>

  <div class="body">
    {#if rides.length === 0}
      <p class="hint">
        Nothing saved yet. Rides are written here as you go — every thirty seconds and again
        when you close the tab — so a browser crash costs you nothing. They stay in this
        browser and are never uploaded.
      </p>
    {:else}
      <ul>
        {#each rides as ride (ride.id)}
          <li>
            <div class="what">
              <strong>{ride.name}</strong>
              <span class="when">{formatWhen(ride.startedAt)}</span>
            </div>

            <dl class="numbers">
              <div><dt>Time</dt><dd>{formatLength(ride.seconds)}</dd></div>
              <div><dt>Distance</dt><dd>{(ride.distanceM / 1000).toFixed(1)} km</dd></div>
              <div><dt>Avg power</dt><dd>{ride.averagePowerW} W</dd></div>
              {#if ride.averageHeartRateBpm !== undefined}
                <div><dt>Avg HR</dt><dd>{ride.averageHeartRateBpm} bpm</dd></div>
              {/if}
              {#if ride.climbedM > 0}
                <div><dt>Climbed</dt><dd>{ride.climbedM} m</dd></div>
              {/if}
            </dl>

            <div class="actions">
              <button onclick={() => onExport(ride)} disabled={busy}>Export</button>
              {#if ride.workoutName}
                <button onclick={() => onRepeat(ride)} disabled={busy}>Ride again</button>
              {/if}
              <button
                class="ghost"
                onclick={() => onDelete(ride)}
                disabled={busy}
                aria-label={`Delete ${ride.name} from ${formatWhen(ride.startedAt)}`}
              >
                Delete
              </button>
            </div>
          </li>
        {/each}
      </ul>

      <div class="footer">
        {#if storage}
          <span class="hint">
            {storage.usedMb.toFixed(1)} MB used of about {Math.round(storage.quotaMb)} MB
            available to this site.
          </span>
        {/if}
        {#if confirming}
          <span class="hint">Delete all {rides.length} rides?</span>
          <button
            class="ghost"
            onclick={() => {
              confirming = false
              onClear()
            }}
          >
            Yes, delete everything
          </button>
          <button onclick={() => (confirming = false)}>Cancel</button>
        {:else}
          <button class="ghost" onclick={() => (confirming = true)}>Delete all</button>
        {/if}
      </div>
    {/if}
  </div>
</details>

<style>
  details {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: var(--radius);
  }

  summary {
    padding: 0.6rem 0.9rem;
    cursor: pointer;
    font-size: 0.88rem;
    font-weight: 600;
    user-select: none;
  }

  .body {
    padding: 0 0.9rem 0.9rem;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  li {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.6rem 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0.45rem;
  }

  .what {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .when {
    font-size: 0.78rem;
    color: var(--muted);
  }

  .numbers {
    display: flex;
    flex-wrap: wrap;
    gap: 0.15rem 1.1rem;
    margin: 0;
  }

  .numbers div {
    display: flex;
    align-items: baseline;
    gap: 0.3rem;
  }

  dt {
    font-size: 0.72rem;
    color: var(--muted);
  }

  dd {
    margin: 0;
    font-size: 0.9rem;
    font-variant-numeric: tabular-nums;
  }

  .actions,
  .footer {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
    align-items: center;
  }

  .footer {
    margin-top: 0.7rem;
    padding-top: 0.6rem;
    border-top: 1px solid var(--line);
  }

  .footer .hint {
    flex: 1 1 12rem;
  }

  .hint {
    margin: 0;
    font-size: 0.78rem;
    color: var(--muted);
    line-height: 1.45;
  }
</style>
