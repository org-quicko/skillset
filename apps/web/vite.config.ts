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
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
})
