<script lang="ts">
  // Phase 1 shell. The ride UI lands in phase 5; this exists so the
  // toolchain has something real to build, mount and screenshot.
  const phases = [
    'GPX parser and route model',
    'Physics and virtual shifting',
    'Ride engine and demo mode',
    'Dashboard UI',
    'TCX export',
    'Bluetooth trainer and Zwift Click',
  ]
</script>

<main>
  <h1>bikeathome</h1>
  <p class="tagline">Ride your own GPX routes on a smart trainer.</p>

  <section>
    <h2>Under construction</h2>
    <ul>
      {#each phases as phase}
        <li>{phase}</li>
      {/each}
    </ul>
  </section>
</main>

<style>
  main {
    max-width: 46rem;
    margin: 0 auto;
    padding: 3rem 1.5rem;
  }

  h1 {
    margin: 0;
    font-size: 2rem;
    letter-spacing: -0.02em;
  }

  .tagline {
    margin: 0.25rem 0 2.5rem;
    color: var(--muted);
  }

  h2 {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--muted);
    font-weight: 600;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--line);
  }

  li {
    padding: 0.7rem 0;
    border-bottom: 1px solid var(--line);
    color: var(--muted);
  }
</style>
