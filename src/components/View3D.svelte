<script lang="ts">
  import { onMount } from 'svelte'
  import { CourseError, readCourseScript, type Course } from '../lib/course/course'
  import type { RideSnapshot } from '../lib/ride/engine'
  import { isFromView, rideUpdate, type ToView } from '../lib/ride3d/protocol'

  interface Props {
    ride: RideSnapshot
    virtualShifting: boolean
    onError: (message: string) => void
  }

  let { ride, virtualShifting, onError }: Props = $props()

  let open = $state(false)
  // Raw: a course is a megabyte of terrain that is posted whole to the view,
  // and a deep proxy could neither be posted nor would it be any use.
  let course = $state.raw<Course | null>(null)
  let generation = $state(0)
  let frame = $state<HTMLIFrameElement | null>(null)
  let box = $state<HTMLDivElement | null>(null)

  /** Same length to within 3%, or the course is probably for another route. */
  const mismatch = $derived(
    course !== null && ride.routeDistance > 0 && Math.abs(course.length - ride.routeDistance) / ride.routeDistance > 0.03,
  )

  function send(message: ToView): void {
    frame?.contentWindow?.postMessage(message, location.origin)
  }

  onMount(() => {
    // The view says when it has loaded; it then gets its course, and the ride.
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame?.contentWindow || !isFromView(event, location.origin)) return
      send({ type: 'course', course })
      send(rideUpdate(ride, virtualShifting))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  })

  // Four times a second, whenever the engine has something new.
  $effect(() => {
    if (open) send(rideUpdate(ride, virtualShifting))
  })

  async function onPick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    try {
      course = readCourseScript(await file.text())
      generation += 1 // a new course means building a new world
      open = true
    } catch (err) {
      onError(err instanceof CourseError ? err.message : `Could not read ${file.name}.`)
    }
  }

  function fullScreen(): void {
    void box?.requestFullscreen?.().catch(() => onError('This browser would not go full screen.'))
  }
</script>

<section class="view3d" aria-label="3D view">
  <div class="bar">
    <button onclick={() => (open = !open)} aria-pressed={open}>
      {open ? 'Hide 3D view' : 'Show 3D view'}
    </button>
    <label class="picker">
      {course ? 'Change 3D course' : 'Load 3D course'}
      <input type="file" accept=".js,text/javascript" onchange={(e) => void onPick(e)} />
    </label>
    {#if open}
      <button onclick={fullScreen}>Full screen</button>
    {/if}
    <span class="note">
      {#if course}
        {course.name}, {(course.length / 1000).toFixed(1)} km
      {:else}
        No course loaded: an invented valley, not your route.
      {/if}
    </span>
  </div>

  {#if mismatch && course}
    <p class="warn" role="status">
      This 3D course is {(course.length / 1000).toFixed(1)} km and the route is
      {(ride.routeDistance / 1000).toFixed(1)} km. Was it made from the same GPX?
    </p>
  {/if}

  {#if open}
    <div class="frame" bind:this={box}>
      {#key generation}
        <iframe bind:this={frame} src={`ride3d.html?course=${generation}`} title="3D view of the ride" allow="fullscreen"
        ></iframe>
      {/key}
    </div>
    <p class="hint">
      Click the view once for wind and tyre sound. Speed, distance and recording all stay here, as on any ride.
    </p>
  {/if}
</section>

<style>
  .view3d {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .note,
  .hint {
    color: var(--muted);
    font-size: 0.85rem;
  }

  .hint {
    margin: 0;
  }

  .warn {
    margin: 0;
    font-size: 0.88rem;
    border: 1px solid var(--warn, var(--accent));
    border-radius: var(--radius);
    padding: 0.5rem 0.75rem;
  }

  .picker {
    position: relative;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 6px 12px;
    cursor: pointer;
    background: var(--panel-2);
  }

  /* Hidden from sight but not from the keyboard, so the label can be reached with Tab. */
  .picker input {
    position: absolute;
    inset: 0;
    opacity: 0;
    width: 100%;
    cursor: pointer;
  }

  .picker:focus-within {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .frame {
    aspect-ratio: 16 / 9;
    width: 100%;
    border-radius: var(--radius);
    overflow: hidden;
    background: #0b0a09;
  }

  .frame:fullscreen {
    aspect-ratio: auto;
    width: 100vw;
    height: 100vh;
    border-radius: 0;
  }

  iframe {
    display: block;
    width: 100%;
    height: 100%;
    border: 0;
  }
</style>
