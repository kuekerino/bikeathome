<script lang="ts">
  /**
   * The live region announcements are read from.
   *
   * Rendering the message inside a keyed block matters: a screen reader
   * announces a live region when its *content changes*, so the same words
   * twice running would be silently dropped. Replacing the node each time
   * makes every announcement land, including a repeated one.
   */
  interface Props {
    message: string
    /** Increments per announcement, so identical text still re-announces. */
    sequence: number
  }

  let { message, sequence }: Props = $props()
</script>

<div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
  {#key sequence}
    <p>{message}</p>
  {/key}
</div>
