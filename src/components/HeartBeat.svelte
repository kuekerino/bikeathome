<script lang="ts">
  /**
   * A heart that beats at the rate the strap is reporting.
   *
   * Decorative, and hidden from screen readers: the number beside it already
   * says everything this does, and a pulsing emoji announced on a loop would
   * be an unusually cruel thing to do to anyone listening.
   *
   * The rhythm is a double thump rather than a single throb, because that is
   * what a heartbeat sounds like and a plain pulse reads as a loading spinner.
   */
  import { beatSeconds } from '../lib/heartbeat'

  interface Props {
    bpm: number
  }

  let { bpm }: Props = $props()

  // Only the duration changes as the rate moves, never the animation itself —
  // renaming it would restart the beat from zero on every reading.
  const seconds = $derived(beatSeconds(bpm))
</script>

<span class="heart" style:--beat="{seconds}s" aria-hidden="true">❤️</span>

<style>
  .heart {
    display: inline-block;
    animation: beat var(--beat) ease-in-out infinite;
    /* Scaling from the middle, so it swells rather than drifts. */
    transform-origin: center;
    will-change: transform;
  }

  @keyframes beat {
    0% {
      transform: scale(1);
    }
    12% {
      transform: scale(1.3);
    }
    24% {
      transform: scale(1);
    }
    36% {
      transform: scale(1.16);
    }
    56% {
      transform: scale(1);
    }
  }

  /* The global reduced-motion rule collapses the duration to nothing, which
     would leave the heart mid-swell. Hold it at rest instead. */
  @media (prefers-reduced-motion: reduce) {
    .heart {
      animation: none;
      transform: none;
    }
  }
</style>
