<script lang="ts">
  /**
   * The running workout: where you are, what is next, and a way out of a step.
   *
   * Skip exists because sessions get interrupted, and being unable to leave a
   * step is the fastest way to make someone close the tab.
   */
  import type { WorkoutProgress } from '../lib/ride/engine'
  import { describeStep, formatDuration } from '../lib/workout/model'

  interface Props {
    progress: WorkoutProgress | null
    ftpW: number | null
    onLoad: (xml: string, filename: string) => void
    onClear: () => void
    onSkip: (direction: 1 | -1) => void
    onFtp: (ftpW: number | null) => void
  }

  let { progress, ftpW, onLoad, onClear, onSkip, onFtp }: Props = $props()

  async function pick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    // Let the same file be chosen twice in a row.
    input.value = ''
    if (file) onLoad(await file.text(), file.name)
  }

  const remaining = $derived(
    progress?.step ? progress.step.endSeconds - progress.elapsedSeconds : 0,
  )
</script>

<section>
  {#if !progress}
    <div class="empty">
      <div>
        <strong>Structured workout</strong>
        <em>
          Load a Zwift <code>.zwo</code> and it drives the power. The route, if you have one,
          still decides how far you get.
        </em>
      </div>
      <label class="picker">
        Load .zwo
        <input type="file" accept=".zwo,application/xml,text/xml" onchange={pick} />
      </label>
    </div>
  {:else}
    <header>
      <div>
        <strong>{progress.name}</strong>
        <em>
          {formatDuration(progress.elapsedSeconds)} of {formatDuration(progress.totalSeconds)}
          · step {Math.min(progress.stepIndex + 1, progress.stepCount)} of {progress.stepCount}
        </em>
      </div>
      <button class="ghost" onclick={onClear}>Remove</button>
    </header>

    <div
      class="bar"
      role="progressbar"
      aria-label="Workout progress"
      aria-valuemin={0}
      aria-valuemax={Math.round(progress.totalSeconds)}
      aria-valuenow={Math.round(progress.elapsedSeconds)}
      aria-valuetext="{formatDuration(progress.elapsedSeconds)} of {formatDuration(
        progress.totalSeconds,
      )}"
    >
      <span
        style:width={`${progress.totalSeconds > 0 ? (100 * progress.elapsedSeconds) / progress.totalSeconds : 0}%`}
      ></span>
    </div>

    {#if progress.blocked}
      <p class="warn">
        This workout is written as a percentage of FTP, and no FTP is set. An FTP test cannot
        itself be written in percentages, which is why the number has to come from somewhere
        first — measure it, or set it below.
      </p>
    {:else if progress.finished}
      <p class="hint">Workout finished. Resistance is back on the gradient.</p>
    {:else if progress.step}
      <div class="now">
        <div class="step">
          <span class="label">
            {progress.step.step.label ?? 'Step'}
            {#if progress.step.repeat}
              · interval {progress.step.repeat.index} of {progress.step.repeat.total}
            {/if}
          </span>
          <span class="target">{describeStep(progress.step.step, ftpW)}</span>
          {#if progress.step.step.cadenceRpm}
            <span class="label">{progress.step.step.cadenceRpm} rpm</span>
          {/if}
        </div>
        <div class="clock">
          <span class="target">{formatDuration(remaining)}</span>
          <span class="label">left</span>
        </div>
      </div>

      <p class="hint">
        {#if progress.next}
          Next: {progress.next.step.label ?? 'step'} — {describeStep(progress.next.step, ftpW)}
          for {formatDuration(progress.next.step.seconds)}
        {:else}
          Last step.
        {/if}
      </p>
    {/if}

    <div class="actions">
      <button onclick={() => onSkip(-1)}>← Back a step</button>
      <button onclick={() => onSkip(1)}>Skip step →</button>
    </div>
  {/if}

  <label class="ftp">
    <span>FTP</span>
    <span class="field">
      <input
        type="number"
        min="50"
        max="600"
        step="1"
        placeholder="—"
        value={ftpW}
        onchange={(e) => {
          const raw = Number(e.currentTarget.value)
          onFtp(Number.isFinite(raw) && raw > 0 ? raw : null)
        }}
      />
      <span class="unit">W</span>
    </span>
  </label>
</section>

<style>
  section {
    border: 1px solid var(--line);
    border-radius: 0.5rem;
    padding: 0.75rem 0.9rem;
    background: var(--panel);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .empty,
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .empty div,
  header div {
    display: flex;
    flex-direction: column;
  }

  em {
    font-style: normal;
    font-size: 0.78rem;
    color: var(--muted);
    max-width: 34rem;
  }

  .bar {
    height: 4px;
    border-radius: 2px;
    background: var(--line);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    background: var(--accent);
  }

  .now {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .step,
  .clock {
    display: flex;
    flex-direction: column;
  }

  .clock {
    align-items: flex-end;
  }

  .target {
    font-size: 1.5rem;
    font-variant-numeric: tabular-nums;
  }

  .label {
    font-size: 0.76rem;
    color: var(--muted);
  }

  .actions {
    display: flex;
    gap: 0.5rem;
  }

  .actions button {
    flex: 1;
  }

  .warn {
    margin: 0;
    font-size: 0.8rem;
    line-height: 1.45;
    color: var(--bad);
  }

  .hint {
    margin: 0;
    font-size: 0.78rem;
    color: var(--muted);
    line-height: 1.45;
  }

  .ftp {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    font-size: 0.88rem;
    flex-wrap: wrap;
    border-top: 1px solid var(--line);
    padding-top: 0.6rem;
  }

  .field {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .field input {
    width: 5rem;
    text-align: right;
  }

  .unit {
    font-size: 0.78rem;
    color: var(--muted);
  }

  .picker {
    display: inline-flex;
    align-items: center;
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: 6px;
    cursor: pointer;
    font-size: 0.85rem;
    background: var(--bg);
  }

  .picker input {
    display: none;
  }
</style>
