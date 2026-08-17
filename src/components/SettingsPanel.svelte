<script lang="ts">
  import type { AppSettings } from '../lib/settings'

  interface Props {
    settings: AppSettings
    onChange: (settings: AppSettings) => void
  }

  let { settings, onChange }: Props = $props()

  function rider<K extends keyof AppSettings['rider']>(key: K, raw: string): void {
    const value = Number(raw)
    if (!Number.isFinite(value)) return
    onChange({ ...settings, rider: { ...settings.rider, [key]: value } })
  }

  function drivetrain<K extends keyof AppSettings['drivetrain']>(
    key: K,
    value: AppSettings['drivetrain'][K],
  ): void {
    onChange({ ...settings, drivetrain: { ...settings.drivetrain, [key]: value } })
  }
</script>

<details>
  <summary>Rider and drivetrain</summary>

  <div class="grid">
    <fieldset>
      <legend>Drivetrain</legend>
      <label class="radio">
        <input
          type="radio"
          name="mode"
          checked={settings.drivetrain.mode === 'virtual'}
          onchange={() => drivetrain('mode', 'virtual')}
        />
        <span>
          <strong>Virtual shifting</strong>
          <em>Single cog, such as the Zwift Cog. The app shifts for you.</em>
        </span>
      </label>
      <label class="radio">
        <input
          type="radio"
          name="mode"
          checked={settings.drivetrain.mode === 'cassette'}
          onchange={() => drivetrain('mode', 'cassette')}
        />
        <span>
          <strong>Real cassette</strong>
          <em>You shift on the bike. The trainer gets the route gradient as it is.</em>
        </span>
      </label>

      {#if settings.drivetrain.mode === 'virtual'}
        <div class="pair">
          <label>
            Chainring
            <input
              type="number"
              min="20"
              max="60"
              value={settings.drivetrain.chainringTeeth}
              onchange={(e) => drivetrain('chainringTeeth', Number(e.currentTarget.value))}
            />
          </label>
          <label>
            Cog
            <input
              type="number"
              min="8"
              max="30"
              value={settings.drivetrain.cogTeeth}
              onchange={(e) => drivetrain('cogTeeth', Number(e.currentTarget.value))}
            />
          </label>
        </div>
        <p class="hint">
          The gear your bike is physically in. Virtual gears are measured against it, so getting
          it right keeps the middle of the block feeling neutral.
        </p>
      {/if}
    </fieldset>

    <fieldset>
      <legend>Rider</legend>
      <label>
        Rider and bike
        <span class="field">
          <input
            type="number"
            min="30"
            max="250"
            step="0.5"
            value={settings.rider.massKg}
            onchange={(e) => rider('massKg', e.currentTarget.value)}
          />
          <span class="unit">kg</span>
        </span>
      </label>
      <label>
        Drag area (CdA)
        <span class="field">
          <input
            type="number"
            min="0.15"
            max="1.2"
            step="0.01"
            value={settings.rider.cda}
            onchange={(e) => rider('cda', e.currentTarget.value)}
          />
          <span class="unit">m²</span>
        </span>
      </label>
      <label>
        Rolling resistance
        <span class="field">
          <input
            type="number"
            min="0.001"
            max="0.02"
            step="0.001"
            value={settings.rider.crr}
            onchange={(e) => rider('crr', e.currentTarget.value)}
          />
          <span class="unit">Crr</span>
        </span>
      </label>
      <p class="hint">
        Weight decides how a climb feels. Set the same figure in the Wahoo app so the trainer's
        own model agrees with this one.
      </p>
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

  label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.88rem;
    flex-wrap: wrap;
  }

  .radio {
    align-items: flex-start;
    justify-content: flex-start;
    gap: 0.55rem;
    cursor: pointer;
  }

  .radio span {
    display: flex;
    flex-direction: column;
  }

  .radio em {
    font-style: normal;
    font-size: 0.78rem;
    color: var(--muted);
  }

  .radio input {
    margin-top: 0.25rem;
    accent-color: var(--accent);
  }

  .pair {
    display: flex;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .pair label {
    flex: 1 1 8rem;
  }

  .field {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .unit {
    font-size: 0.78rem;
    color: var(--muted);
    min-width: 1.6rem;
  }

  input[type='number'] {
    width: 5.5rem;
    background: var(--bg);
    color: inherit;
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 5px 8px;
    font: inherit;
    font-variant-numeric: tabular-nums;
  }

  input[type='number']:focus {
    outline: none;
    border-color: var(--accent);
  }

  .hint {
    margin: 0;
    font-size: 0.76rem;
    color: var(--muted);
    line-height: 1.45;
  }
</style>
