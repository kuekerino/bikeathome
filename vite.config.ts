import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte()],
  // Relative base so the built site works from any path: a GitHub Pages
  // project subpath, a Netlify/Cloudflare root, or a local preview.
  base: './',
  build: {
    // Three.js makes the 3D view's script about 575 KB; it is fetched only
    // when that view is opened, so it is not worth a warning on every build.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      // Two pages: the app, and the 3D view it shows in a frame. Three.js and
      // the textures belong to the second alone, so the app stays as small as
      // it was and loads none of it until the 3D view is opened.
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        ride3d: fileURLToPath(new URL('ride3d.html', import.meta.url)),
      },
    },
  },
  // Default to node: nearly everything under test is pure. The few files that
  // need a DOM opt in with a `@vitest-environment jsdom` docblock.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
