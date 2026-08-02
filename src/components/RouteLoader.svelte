<script lang="ts">
  interface Props {
    onFile: (text: string, filename: string) => void
    onDemo: () => void
    busy?: boolean
  }

  let { onFile, onDemo, busy = false }: Props = $props()

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

<style>
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
    color: #1a1300;
    font-weight: 600;
    border-radius: var(--radius);
    padding: 8px 14px;
    cursor: pointer;
  }

  .picker input {
    display: none;
  }
</style>
