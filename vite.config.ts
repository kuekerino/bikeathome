import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [svelte()],
  // Relative base so the built site works from any path: a GitHub Pages
  // project subpath, a Netlify/Cloudflare root, or a local preview.
  base: './',
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
})
