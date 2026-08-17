<script lang="ts">
  interface Props {
    onFile: (text: string, filename: string) => void
    onDemo: () => void
    onFree: () => void
    busy?: boolean
  }

  let { onFile, onDemo, onFree, busy = false }: Props = $props()

  let dragging = $state(false)

  async function accept(file: File | undefined): Promise<void> {
    if (!file) return
    onFile(await file.text(), file.name)
  }

  function onDrop(event: DragEvent): void {
    event.preventDefault()
    dragging = false
    void accept(event.dataTransfer?.files?.[0])
  }

  function onPick(event: Event): void {
    const input = event.target as HTMLInputElement
    void accept(input.files?.[0])
    // Let the same file be chosen twice in a row.
    input.value = ''
  }
</script>

<div
  class="drop"
  class:dragging
  role="region"
  aria-label="Load a route"
  ondragover={(e) => {
    e.preventDefault()
    dragging = true
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  <p class="headline">Drop a GPX file here</p>
  <p class="muted">Your route never leaves this browser.</p>

  <div class="actions">
    <label class="picker">
      Choose a file
      <input type="file" accept=".gpx,application/gpx+xml,text/xml" onchange={onPick} />
    </label>
    <button onclick={onDemo} disabled={busy}>Or try the demo climb</button>
  </div>
</div>

<div class="free">
  <div>
    <p class="headline">No route — just pedal</p>
    <p class="muted">
      Set a wattage and hold it, like an exercise bike. Flat and endless, and it still
      records and exports.
    </p>
  </div>
  <button onclick={onFree} disabled={busy}>Just pedal</button>
</div>

<style>
  .free {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
    margin-top: var(--gap);
    padding: 1rem 1.25rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    background: var(--panel);
    text-align: left;
  }

  .free .headline {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .free .muted {
    margin: 0.2rem 0 0;
    max-width: 34rem;
  }

  .drop {
    border: 2px dashed var(--line);
    border-radius: var(--radius);
    padding: 2rem 1.25rem;
    text-align: center;
    transition: border-color 120ms ease, background-color 120ms ease;
  }

  .drop.dragging {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  p {
    margin: 0;
  }

  .headline {
    font-size: 1.05rem;
    font-weight: 600;
  }

  .muted {
    color: var(--muted);
    font-size: 0.85rem;
    margin-top: 0.2rem;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    justify-content: center;
    flex-wrap: wrap;
    margin-top: 1.1rem;
  }

  .picker {
    background: var(--accent);
    color: var(--on-accent);
    font-weight: 600;
    border-radius: var(--radius);
    padding: 8px 14px;
    cursor: pointer;
  }

  .picker input {
    display: none;
  }
</style>
