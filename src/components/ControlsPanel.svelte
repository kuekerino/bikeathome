<script lang="ts">
  /**
   * Remapping: what each key and each Click button does.
   *
   * Keys are captured rather than typed. Asking someone to write "arrowright"
   * invites the one typo that silently does nothing, and a captured key is
   * exactly the key they will press mid-ride.
   */
  import { ACTION_LABELS, RIDE_ACTIONS, type RideAction } from '../lib/controls/actions'
  import {
    actionForButton,
    DEFAULT_BINDINGS,
    describeKey,
    isKnownButton,
    normaliseKey,
    type Bindings,
  } from '../lib/controls/bindings'

  interface Props {
    bindings: Bindings
    /** Button ids this shifter has actually sent, in the order first seen. */
    seenButtons: readonly string[]
    onChange: (bindings: Bindings) => void
  }

  let { bindings, seenButtons, onChange }: Props = $props()

  function setButton(id: string, action: RideAction): void {
    onChange({ ...bindings, buttons: { ...bindings.buttons, [id]: action } })
  }

  let capturing = $state(false)

  const rows = $derived(
    Object.entries(bindings.keys).sort(([a], [b]) => describeKey(a).localeCompare(describeKey(b))),
  )

  function setKey(key: string, action: RideAction): void {
    onChange({ ...bindings, keys: { ...bindings.keys, [key]: action } })
  }

  function removeKey(key: string): void {
    const keys = { ...bindings.keys }
    delete keys[key]
    onChange({ ...bindings, keys })
  }

  function setClick(side: 'up' | 'down', action: RideAction): void {
    onChange({ ...bindings, click: { ...bindings.click, [side]: action } })
  }

  function capture(event: KeyboardEvent): void {
    event.preventDefault()
    event.stopPropagation()
    capturing = false
    if (event.key === 'Escape') return
    // A new key lands on "nothing" so a mis-capture cannot do something
    // surprising before it has been given a meaning.
    setKey(normaliseKey(event.key), 'nothing')
  }
</script>

<details>
  <summary>Controls</summary>

  <div class="grid">
    <fieldset>
      <legend>Shifter buttons</legend>

      {#if seenButtons.length === 0}
        <p class="hint">
          Press a button on your shifter and it will appear here. Nothing is guessed: whatever
          your unit reports gets its own row, and you say what it does.
        </p>
      {/if}

      {#each seenButtons as id (id)}
        <div class="row">
          <kbd class:unknown={!isKnownButton(id)}>{id}</kbd>
          <select
            value={actionForButton(bindings, id)}
            onchange={(e) => setButton(id, e.currentTarget.value as RideAction)}
          >
            {#each RIDE_ACTIONS as option (option)}
              <option value={option}>{ACTION_LABELS[option]}</option>
            {/each}
          </select>
        </div>
      {/each}

      <details class="fallback">
        <summary>Defaults for buttons we recognise</summary>
        <label>
          Up-ish button
          <select
            value={bindings.click.up}
            onchange={(e) => setClick('up', e.currentTarget.value as RideAction)}
          >
            {#each RIDE_ACTIONS as action (action)}
              <option value={action}>{ACTION_LABELS[action]}</option>
            {/each}
          </select>
        </label>
        <label>
          Down-ish button
          <select
            value={bindings.click.down}
            onchange={(e) => setClick('down', e.currentTarget.value as RideAction)}
          >
            {#each RIDE_ACTIONS as action (action)}
              <option value={action}>{ACTION_LABELS[action]}</option>
            {/each}
          </select>
        </label>
        <p class="hint">
          Only used for buttons whose id matches a documented layout. Anything else does nothing
          until you give it a row above.
        </p>
      </details>
    </fieldset>

    <fieldset>
      <legend>Keyboard</legend>

      {#each rows as [key, action] (key)}
        <div class="row">
          <kbd>{describeKey(key)}</kbd>
          <select value={action} onchange={(e) => setKey(key, e.currentTarget.value as RideAction)}>
            {#each RIDE_ACTIONS as option (option)}
              <option value={option}>{ACTION_LABELS[option]}</option>
            {/each}
          </select>
          <button
            class="ghost"
            onclick={() => removeKey(key)}
            aria-label={`Unbind ${describeKey(key)}`}
          >
            ✕
          </button>
        </div>
      {/each}

      {#if rows.length === 0}
        <p class="hint">Nothing bound. The buttons on screen still work.</p>
      {/if}

      <div class="row add">
        <button onclick={() => (capturing = true)} onkeydown={capturing ? capture : undefined}>
          {capturing ? 'Press a key…' : 'Add a key'}
        </button>
        <button class="ghost" onclick={() => onChange(structuredClone(DEFAULT_BINDINGS))}>
          Reset to defaults
        </button>
      </div>
    </fieldset>
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

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(19rem, 100%), 1fr));
    gap: var(--gap);
    padding: 0 0.9rem 0.9rem;
  }

  fieldset {
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.7rem 0.9rem 0.9rem;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 0;
  }

  legend {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    padding: 0 0.3rem;
  }

  label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.88rem;
    flex-wrap: wrap;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .row select {
    flex: 1;
  }

  .add {
    margin-top: 0.35rem;
  }

  kbd.unknown {
    border-style: dashed;
    color: var(--muted);
  }

  .fallback summary {
    padding: 0.2rem 0;
    font-size: 0.78rem;
    font-weight: 400;
    color: var(--muted);
  }

  .fallback label {
    margin-top: 0.4rem;
  }

  kbd {
    min-width: 5.5rem;
    text-align: center;
    font-size: 0.75rem;
    padding: 3px 6px;
    border: 1px solid var(--line);
    border-radius: 5px;
    background: var(--bg);
  }

  select {
    background: var(--bg);
    color: inherit;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 5px 8px;
    font: inherit;
    font-size: 0.85rem;
  }

  select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .hint {
    margin: 0.2rem 0 0;
    font-size: 0.76rem;
    color: var(--muted);
    line-height: 1.45;
  }
</style>
