import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte()],
  // Relative base so the built site works from any path: a GitHub Pages
  // project subpath, a Netlify/Cloudflare root, or a local preview.
  base: './',
  // Default to node: nearly everything under test is pure. The few files that
  // need a DOM opt in with a `@vitest-environment jsdom` docblock.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
