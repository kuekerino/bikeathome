<script lang="ts">
  import { TEXT_SCALES, type AppearanceSettings, type ThemeChoice } from '../lib/appearance'

  interface Props {
    appearance: AppearanceSettings
    onChange: (appearance: AppearanceSettings) => void
  }

  let { appearance, onChange }: Props = $props()

  const THEMES: { value: ThemeChoice; label: string }[] = [
    { value: 'system', label: 'System' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ]

  function set<K extends keyof AppearanceSettings>(key: K, value: AppearanceSettings[K]): void {
    onChange({ ...appearance, [key]: value })
  }
</script>

<details>
  <summary>Appearance and accessibility</summary>

  <div class="grid">
    <fieldset>
      <legend>Theme</legend>
      <div class="segmented" role="group" aria-label="Theme">
        {#each THEMES as option (option.value)}
          <button
            type="button"
            class:on={appearance.theme === option.value}
            aria-pressed={appearance.theme === option.value}
            onclick={() => set('theme', option.value)}
          >
            {option.label}
          </button>
        {/each}
      </div>

      <label class="check">
        <input
          type="checkbox"
          checked={appearance.highContrast}
          onchange={(e) => set('highContrast', e.currentTarget.checked)}
        />
        <span>
          <strong>High contrast</strong>
          <em>Stronger colours and visible borders, on top of either theme.</em>
        </span>
      </label>
    </fieldset>

    <fieldset>
      <legend>Text size</legend>
      <div class="segmented" role="group" aria-label="Text size">
        {#each TEXT_SCALES as scale (scale)}
          <button
            type="button"
            class:on={appearance.textScale === scale}
            aria-pressed={appearance.textScale === scale}
            onclick={() => set('textScale', scale)}
          >
            {Math.round(scale * 100)}%
          </button>
        {/each}
      </div>

      <label class="check">
        <input
          type="checkbox"
          checked={appearance.announce}
          onchange={(e) => set('announce', e.currentTarget.checked)}
        />
        <span>
          <strong>Announce what changes</strong>
          <em>
            Reads out new intervals, the heart rate ceiling and the ride starting or
            finishing. Not the live numbers — those would drown everything else. Bind
            <strong>Read the numbers aloud</strong> to a key or a shifter button to hear those
            when you want them.
          </em>
        </span>
      </label>
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
    grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
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
    gap: 0.6rem;
    min-width: 0;
  }

  legend {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    padding: 0 0.3rem;
  }

  .segmented {
    display: flex;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .segmented button {
    flex: 1;
    min-width: 4rem;
    padding: 6px 10px;
    font-size: 0.85rem;
  }

  /* A border as well as a fill: on high contrast the fill alone can vanish,
     and the selected item has to stay identifiable without colour. */
  .segmented button.on {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
    font-weight: 600;
  }

  .check {
    display: flex;
    align-items: flex-start;
    gap: 0.55rem;
    cursor: pointer;
    font-size: 0.88rem;
  }

  .check span {
    display: flex;
    flex-direction: column;
  }

  .check em {
    font-style: normal;
    font-size: 0.78rem;
    color: var(--muted);
    line-height: 1.45;
  }

  .check input {
    margin-top: 0.25rem;
    accent-color: var(--accent);
  }
</style>
