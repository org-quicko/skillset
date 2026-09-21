import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    // In production the API serves the built SPA from the same origin; in
    // dev the two run on separate ports, so proxy to the API dev server.
    // `/openapi.json` and `/mcp` (which also covers `/mcp.mcpb` — Vite
    // prefix-matches a plain string key) are the API's own top-level routes,
    // not under `/api` (see apps/api/src/app.ts), and need the same proxy to
    // be reachable from this dev server.
    proxy: {
      '/api': 'http://localhost:3000',
      '/openapi.json': 'http://localhost:3000',
      '/mcp': 'http://localhost:3000',
    },
  },
})
